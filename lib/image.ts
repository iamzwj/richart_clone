import type { DesignBrief } from "@/lib/design";
import { designResolutionFor } from "@/lib/design-sizes";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type GeneratedImage = {
  url: string;
};

const MODEL = "gpt-image-2.5-sunburst";
const FALLBACK_MODEL = "gpt-image-2.5";
const QUALITY = "high";
const MAX_REFERENCE_LENGTH = 6_000_000;
const MAX_REFERENCE_BYTES = 4 * 1024 * 1024;
const MAX_SAVED_IMAGE_BYTES = 24 * 1024 * 1024;
const generatedImageDir = process.env.GENERATED_IMAGE_STORE_PATH || join(process.cwd(), "data", "generated");

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

async function pollResult(id: string): Promise<string[]> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const response = await fetch(`${apiBaseUrl()}/v1/api/result?id=${encodeURIComponent(id)}`, {
      method: "GET",
      headers: apiHeaders(),
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    const message = errorMessage(data) || (!response.ok && "生图服务暂时不可用，请稍后重试。");
    if (message) throw new Error(message);
    const urls = imageUrlCandidates(data);
    if (urls.length) return [...new Set(urls)];
  }
  throw new Error("生图等待超时，请稍后重试。");
}

export function buildDesignPrompt(brief: DesignBrief, constraints: string[], modification?: string, isReferenceEdit = false): string {
  if (isReferenceEdit) {
    return [
      "图片编辑任务：以提供的参考图为基础进行修改。",
      "除非修改要求明确提出，请保留参考图的原始画布比例、构图、主体和视觉风格。",
      brief.size ? `输出比例：${brief.size}；以 2K 清晰度生成。` : "保持参考图原有的比例与尺寸，并以 2K 清晰度生成。",
      `修改要求：${modification}`,
      constraints.length ? `项目约束：${constraints.join("；")}。` : "",
      "不要添加水印或无关品牌名称。",
    ].filter(Boolean).join("\n");
  }
  return [
    "用途：营销宣传",
    "素材类型：中文营销海报",
    "设计任务：根据以下需求完成一张可直接使用的海报。",
    `主标题（须原样展示）：“${brief.title}”`,
    brief.subtitle ? `副标题（须原样展示）：“${brief.subtitle}”` : "不展示副标题。",
    brief.copy ? `正文文案（须原样展示）：“${brief.copy}”` : "不展示正文文案。",
    brief.supplement ? `补充要求：${brief.supplement}` : "",
    `画布比例：${brief.size}；以 2K 清晰度生成。`,
    `视觉风格：${brief.style}。`,
    "设计要求：中文文案尽量准确，信息层级清晰，保留充足安全边距；不要添加水印或无关品牌名称。",
    constraints.length ? `项目约束：${constraints.join("；")}。` : "",
    modification ? `修改要求：${modification}` : "",
  ].filter(Boolean).join("\n");
}

function shouldUseFallbackModel(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /模型.*(?:修复|维护|不可用)|model.*(?:repair|maintenance|unavailable)/i.test(message);
}

function shouldEmbedReference(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /image upload failed|图片上传失败/i.test(message);
}

async function embedReferenceImage(source: string): Promise<string> {
  if (source.startsWith("data:image/")) return source;
  const url = new URL(source);
  if (url.pathname === "/api/design/image") {
    const saved = await readGeneratedImage(url.searchParams.get("id") || "");
    if (!saved) throw new Error("参考图暂时无法读取，请重新上传后再试。");
    if (saved.data.length > MAX_REFERENCE_BYTES) throw new Error("参考图过大，请上传不超过 4MB 的图片。");
    return `data:${saved.contentType};base64,${saved.data.toString("base64")}`;
  }

  try {
    const response = await fetch(source, { cache: "no-store" });
    const metadata = extensionFor(response.headers.get("content-type") || "");
    if (!response.ok || !metadata) throw new Error("参考图暂时无法读取，请重新上传后再试。");
    const image = Buffer.from(await response.arrayBuffer());
    if (!image.length || image.length > MAX_REFERENCE_BYTES) throw new Error("参考图过大，请上传不超过 4MB 的图片。");
    return `data:${metadata.contentType};base64,${image.toString("base64")}`;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("参考图")) throw error;
    throw new Error("参考图暂时无法读取，请重新上传后再试。");
  }
}

async function createOne(brief: DesignBrief, references: string[], constraints: string[], modification?: string, prompt?: string): Promise<string[]> {
  if (references.some((reference) => reference.length > MAX_REFERENCE_LENGTH)) {
    throw new Error("参考图过大，请上传不超过 4MB 的图片。");
  }

  const requestImage = async (model: string, imageReferences: string[]) => {
    let response: Response;
    try {
      response = await fetch(`${apiBaseUrl()}/v1/api/generate`, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({
          model,
          prompt: prompt || buildDesignPrompt(brief, constraints, modification, references.length > 0 && Boolean(modification)),
          images: imageReferences,
          aspectRatio: designResolutionFor(brief.size),
          quality: QUALITY,
          replyType: "json",
        }),
        cache: "no-store",
      });
    } catch {
      throw new Error("生图服务连接失败，请稍后重试。");
    }
    const result = await response.json().catch(() => ({}));
    const message = errorMessage(result) || (!response.ok && "生图服务暂时不可用，请稍后重试。");
    if (message) throw new Error(message);
    const urls = imageUrlCandidates(result);
    const id = taskId(result);
    return urls.length ? [...new Set(urls)] : id ? pollResult(id) : [];
  };

  let model = MODEL;
  let imageReferences = references;
  let retriedWithEmbeddedReference = false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await requestImage(model, imageReferences);
    } catch (error) {
      if (imageReferences.length && !retriedWithEmbeddedReference && shouldEmbedReference(error)) {
        imageReferences = await Promise.all(imageReferences.map(embedReferenceImage));
        retriedWithEmbeddedReference = true;
        continue;
      }
      if (model === MODEL && shouldUseFallbackModel(error)) {
        model = FALLBACK_MODEL;
        continue;
      }
      throw error;
    }
  }

  throw new Error("生图服务暂时不可用，请稍后重试。");
}

export async function generateDesignImages(
  brief: DesignBrief,
  references: string[],
  constraints: string[],
  modification?: string,
  count = 2,
  filenamePrompt?: string,
  prompt?: string,
): Promise<GeneratedImage[]> {
  const batches = await Promise.all(Array.from({ length: count }, () => createOne(brief, references, constraints, modification, prompt)));
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

/**
 * Store browser uploads alongside generated files so editing can use a stable URL.
 * If the provider cannot retrieve that URL, generation retries once with image data.
 */
export async function persistReferenceImage(dataUrl: string): Promise<string | null> {
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=]+)$/i);
  if (!match) return null;

  const metadata = extensionFor(match[1]);
  if (!metadata) return null;
  const image = Buffer.from(match[2], "base64");
  if (!image.length || image.length > MAX_REFERENCE_BYTES) {
    throw new Error("参考图过大，请上传不超过 4MB 的图片。");
  }

  const id = `${randomUUID()}.${metadata.extension}`;
  await mkdir(generatedImageDir, { recursive: true });
  await writeFile(join(generatedImageDir, id), image, { mode: 0o600 });
  return `/api/design/image?id=${id}`;
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
