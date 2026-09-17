import type { DesignBrief } from "@/lib/design";

export type GeneratedImage = {
  url: string;
};

const MODEL = "gpt-image-2.5-sunburst";
const QUALITY = "high";
const IMAGE_SIZE = "2K";
const MAX_REFERENCE_LENGTH = 6_000_000;

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

function createPrompt(brief: DesignBrief, modification?: string): string {
  return [
    "Use case: ads-marketing",
    "Asset type: Chinese marketing poster",
    `Primary request: Create a finished poster using the supplied brief.`,
    `Main title (verbatim): "${brief.title}"`,
    `Subtitle (verbatim): "${brief.subtitle}"`,
    `Body copy (verbatim): "${brief.copy}"`,
    `Canvas aspect ratio: ${brief.size}; render at 2K.`,
    `Style/medium: ${brief.style}.`,
    "Constraints: Preserve Chinese copy exactly where possible, create clear information hierarchy, keep generous safe margins, no watermark, no extra brand names.",
    modification ? `Modification instructions: ${modification}` : "",
  ].filter(Boolean).join("\n");
}

async function createOne(brief: DesignBrief, references: string[], modification?: string): Promise<string[]> {
  if (references.some((reference) => reference.length > MAX_REFERENCE_LENGTH)) {
    throw new Error("参考图过大，请上传不超过 4MB 的图片。");
  }

  const response = await fetch(`${apiBaseUrl()}/v1/draw/completions`, {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify({
      model: MODEL,
      prompt: createPrompt(brief, modification),
      size: brief.size,
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
  modification?: string,
  count = 2,
): Promise<GeneratedImage[]> {
  const batches = await Promise.all(Array.from({ length: count }, () => createOne(brief, references, modification)));
  const urls = batches.flat().filter(Boolean).slice(0, count);
  if (!urls.length) throw new Error("生图服务没有返回图片，请稍后重试。");
  return urls.map((url) => ({ url }));
}

export function isAllowedImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (
      url.hostname.endsWith(".grsai-resource.com") ||
      url.hostname.endsWith(".grsai.com") ||
      url.hostname.endsWith(".grsai.ai")
    );
  } catch {
    return false;
  }
}
