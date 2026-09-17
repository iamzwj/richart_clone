import type { DesignBrief } from "@/lib/design";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type GeneratedImage = {
  url: string;
};

const MODEL = "gpt-image-2.5-sunburst";
const QUALITY = "high";
const IMAGE_SIZE = "2K";
const MAX_REFERENCE_LENGTH = 6_000_000;
const MAX_SAVED_IMAGE_BYTES = 24 * 1024 * 1024;
const generatedImageDir = process.env.GENERATED_IMAGE_STORE_PATH || join(process.cwd(), "data", "generated");
const SIZE_BY_RATIO: Record<string, string> = {
  "1:1": "1024x1024",
  "9:16": "1024x1792",
  "3:4": "1024x1365",
  "4:3": "1365x1024",
  "16:9": "1792x1024",
};

function imageDimensions(image: Buffer, contentType: string): { width: number; height: number } | null {
  if (contentType.includes("png") && image.length >= 24) {
    return { width: image.readUInt32BE(16), height: image.readUInt32BE(20) };
  }

  if (contentType.includes("jpeg")) {
    for (let index = 2; index + 9 < image.length;) {
      if (image[index] !== 0xff) { index += 1; continue; }
      const marker = image[index + 1];
      if (marker === 0xd8 || marker === 0xd9) { index += 2; continue; }
      const length = image.readUInt16BE(index + 2);
      if (length < 2 || index + length + 2 > image.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { width: image.readUInt16BE(index + 7), height: image.readUInt16BE(index + 5) };
      }
      index += length + 2;
    }
  }

  if (contentType.includes("webp") && image.length >= 30 && image.toString("ascii", 0, 4) === "RIFF") {
    const chunk = image.toString("ascii", 12, 16);
    if (chunk === "VP8X" && image.length >= 30) {
      return { width: image.readUIntLE(24, 3) + 1, height: image.readUIntLE(27, 3) + 1 };
    }
    if (chunk === "VP8 " && image.length >= 30) {
      return { width: image.readUInt16LE(26) & 0x3fff, height: image.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === "VP8L" && image.length >= 25) {
      const bits = image.readUInt32LE(21);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
  }

  return null;
}

function filenameStem(prompt: string): string {
  const prefix = Array.from(prompt.replace(/\s/g, "").replace(/[\\/:*?\"<>|]/g, "")).slice(0, 8).join("");
  return prefix || "设计方案";
}

function modelPixelSize(size: string): string | undefined {
  const normalised = size.toLowerCase().replace(/[：]/g, ":").replace(/[×*]/g, "x").replace(/\s/g, "");
  return SIZE_BY_RATIO[normalised] || (/^\d{3,4}x\d{3,4}$/.test(normalised) ? normalised : undefined);
}

function apiBaseUrl(): string {
  return (process.env.GRSAI_BASE_URL || "https://grsaiapi.com").replace(/\/$/, "");
}

function apiHeaders(): HeadersInit {
  const apiKey = process.env.GRSAI_API_KEY;
  if (!apiKey) throw new Error("GRSAI_API_KEY is not configured.");
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
}

function imageUrlCandidates(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const direct = [record.url, record.imageUrl, record.image_url].filter(
    (item): item is string => typeof item === "string" && /^https?:\/\//.test(item),
  );
  const nested = [record.data, record.result, record.results, record.images]
    .flatMap((item) => Array.isArray(item) ? item : [item])
    .flatMap(imageUrlCandidates);
  return [...direct, ...nested];
}

function taskId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return [record.taskId, record.task_id, record.id, record.drawId].find(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
}

function errorMessage(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.error === "string") return record.error;
  const failed = record.status === "failed" || record.status === "error";
  return failed && typeof record.message === "string" ? record.message : undefined;
}

async function readSse(response: Response): Promise<{ urls: string[]; id?: string }> {
  if (!response.ok) throw new Error(`生图服务请求失败（${response.status}）。`);
  if (!response.body) throw new Error("生图服务没有返回结果。");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let urls: string[] = [];
  let id: string | undefined;

  const consume = (raw: string) => {
    const data = raw.trim().replace(/^data:\s*/, "");
    if (!data || data === "[DONE]") return;
    try {
      const event = JSON.parse(data);
      const eventError = errorMessage(event);
      if (eventError) throw new Error(eventError);
      urls = [...urls, ...imageUrlCandidates(event)];
      id ||= taskId(event);
    } catch (error) {
      if (error instanceof SyntaxError) return;
      throw error;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) consume(line);

    if (done) {
      consume(buffer);
      break;
    }
  }

  return { urls: [...new Set(urls)], id };
}

async function pollResult(id: string): Promise<string[]> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const response = await fetch(`${apiBaseUrl()}/v1/draw/result`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ taskId: id, id }),
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    const message = errorMessage(data);
    if (message) throw new Error(message);
    const urls = imageUrlCandidates(data);
    if (urls.length) return [...new Set(urls)];
  }
  throw new Error("生图等待超时，请稍后重试。");
}

function createPrompt(brief: DesignBrief, constraints: string[], modification?: string, isReferenceEdit = false): string {
  if (isReferenceEdit) {
    return [
      "Image editing task: use the supplied image as the source image.",
      "Preserve the source image's original canvas ratio, composition, subject, and visual style unless the modification explicitly requests a change.",
      brief.size ? `Requested output size: ${brief.size}; render at 2K.` : "Keep the source image's original size and aspect ratio; render at 2K.",
      `Modification instructions: ${modification}`,
      constraints.length ? `Project constraints: ${constraints.join("; ")}.` : "",
      "No watermark, no extra brand names.",
    ].filter(Boolean).join("\n");
  }
  return [
    "Use case: ads-marketing",
    "Asset type: Chinese marketing poster",
    `Primary request: Create a finished poster using the supplied brief.`,
    `Main title (verbatim): "${brief.title}"`,
    brief.subtitle ? `Subtitle (verbatim): "${brief.subtitle}"` : "Do not include a subtitle.",
    brief.copy ? `Body copy (verbatim): "${brief.copy}"` : "Do not include body copy.",
    `Canvas aspect ratio: ${brief.size}; render at 2K.`,
    `Style/medium: ${brief.style}.`,
    "Constraints: Preserve Chinese copy exactly where possible, create clear information hierarchy, keep generous safe margins, no watermark, no extra brand names.",
    constraints.length ? `Project constraints: ${constraints.join("; ")}.` : "",
    modification ? `Modification instructions: ${modification}` : "",
  ].filter(Boolean).join("\n");
}

async function createOne(brief: DesignBrief, references: string[], constraints: string[], modification?: string): Promise<string[]> {
  if (references.some((reference) => reference.length > MAX_REFERENCE_LENGTH)) {
    throw new Error("参考图过大，请上传不超过 4MB 的图片。");
  }

  const response = await fetch(`${apiBaseUrl()}/v1/draw/completions`, {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify({
      model: MODEL,
      prompt: createPrompt(brief, constraints, modification, references.length > 0 && Boolean(modification)),
      size: modelPixelSize(brief.size),
      imageSize: IMAGE_SIZE,
      quality: QUALITY,
      variants: 1,
      urls: references.length ? references : undefined,
      shutProgress: false,
    }),
    cache: "no-store",
  });

  const result = await readSse(response);
  return result.urls.length ? result.urls : result.id ? pollResult(result.id) : [];
}

export async function generateDesignImages(
  brief: DesignBrief,
  references: string[],
  constraints: string[],
  modification?: string,
  count = 2,
  filenamePrompt?: string,
): Promise<GeneratedImage[]> {
  const batches = await Promise.all(Array.from({ length: count }, () => createOne(brief, references, constraints, modification)));
  const urls = batches.flat().filter(Boolean).slice(0, count);
  if (!urls.length) throw new Error("生图服务没有返回图片，请稍后重试。");
  const namingPrompt = filenamePrompt || modification || brief.title || brief.copy || "设计方案";
  return Promise.all(urls.map(async (url) => ({ url: await saveGeneratedImage(url, namingPrompt) })));
}

function extensionFor(contentType: string): { extension: "png" | "jpg" | "webp"; contentType: string } | null {
  if (contentType.includes("image/png")) return { extension: "png", contentType: "image/png" };
  if (contentType.includes("image/webp")) return { extension: "webp", contentType: "image/webp" };
  if (contentType.includes("image/jpeg") || contentType.includes("image/jpg")) return { extension: "jpg", contentType: "image/jpeg" };
  return null;
}

async function saveGeneratedImage(source: string, prompt: string): Promise<string> {
  const response = await fetch(source, { cache: "no-store" });
  if (!response.ok) throw new Error("生成图片暂时无法保存，请重新生成。");
  const metadata = extensionFor(response.headers.get("content-type") || "");
  if (!metadata) throw new Error("生成图片格式不受支持。");
  const image = Buffer.from(await response.arrayBuffer());
  if (!image.length || image.length > MAX_SAVED_IMAGE_BYTES) throw new Error("生成图片文件异常，请重新生成。");
  const dimensions = imageDimensions(image, metadata.contentType);
  const id = `${randomUUID()}.${metadata.extension}`;
  const filename = `${filenameStem(prompt)}_${dimensions ? `${dimensions.width}x${dimensions.height}` : "未知分辨率"}.${metadata.extension}`;
  await mkdir(generatedImageDir, { recursive: true });
  await writeFile(join(generatedImageDir, id), image, { mode: 0o600 });
  await writeFile(join(generatedImageDir, `${id}.json`), JSON.stringify({ filename }), { mode: 0o600 });
  return `/api/design/image?id=${id}`;
}

export async function readGeneratedImage(id: string): Promise<{ data: Buffer; contentType: string; filename: string } | null> {
  const match = id.match(/^([0-9a-f-]{36})\.(png|jpg|webp)$/i);
  if (!match) return null;
  try {
    const extension = match[2].toLowerCase();
    const contentType = extension === "jpg" ? "image/jpeg" : `image/${extension}`;
    const defaultFilename = `设计方案_未知分辨率.${extension}`;
    const metadata: { filename?: unknown } = await readFile(join(generatedImageDir, `${id}.json`), "utf8")
      .then((value) => JSON.parse(value) as { filename?: unknown })
      .catch(() => ({}));
    const filename = typeof metadata.filename === "string" ? metadata.filename : defaultFilename;
    return { data: await readFile(join(generatedImageDir, id)), contentType, filename };
  } catch {
    return null;
  }
}

export function isAllowedImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (
      url.hostname.endsWith(".grsai-resource.com") ||
      url.hostname.endsWith(".grsai.com") ||
      url.hostname.endsWith(".grsai.ai") ||
      url.hostname.endsWith(".aitohumanize.com")
    );
  } catch {
    return false;
  }
}
