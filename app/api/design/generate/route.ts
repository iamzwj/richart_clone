import { NextRequest, NextResponse } from "next/server";
import { missingFields, normaliseBrief } from "@/lib/design";
import { generateDesignImages, isAllowedImageUrl, persistReferenceImage } from "@/lib/image";
import { isRateLimited } from "@/lib/rate-limit";

export const runtime = "nodejs";

function clientAddress(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

async function normaliseReference(value: string, origin: string): Promise<string | null> {
  if (value.startsWith("data:image/")) {
    const savedImage = await persistReferenceImage(value);
    return savedImage ? new URL(savedImage, origin).toString() : null;
  }

  if (isAllowedImageUrl(value)) return value;

  // Generated images live on this server. Give the provider a public, random-id URL
  // instead of sending the image bytes inside the JSON request.
  if (value.startsWith("/api/design/image")) {
    return new URL(value, origin).toString();
  }

  return null;
}

export async function POST(request: NextRequest) {
  if (isRateLimited(`design-image:${clientAddress(request)}`, 8)) {
    return NextResponse.json({ error: "生成请求过于频繁，请稍后再试。" }, { status: 429 });
  }

  try {
    const body = await request.json() as {
      brief?: unknown;
      references?: unknown;
      constraints?: unknown;
      modification?: unknown;
      count?: unknown;
      filenamePrompt?: unknown;
      prompt?: unknown;
    };
    const brief = normaliseBrief(
      body.brief && typeof body.brief === "object" ? body.brief as Record<string, unknown> : {},
    );
    const rawReferences = Array.isArray(body.references)
      ? body.references.filter((item): item is string => typeof item === "string").slice(0, 4)
      : [];
    const references = (await Promise.all(rawReferences.map((item) => normaliseReference(item, request.nextUrl.origin)))).filter((item): item is string => Boolean(item));
    const modification = typeof body.modification === "string" ? body.modification.trim().slice(0, 2_000) : undefined;
    const isReferenceEdit = references.length > 0 && Boolean(modification);
    if (!isReferenceEdit && missingFields(brief).length) {
      return NextResponse.json({ error: "请先补全主标题、比例和风格。" }, { status: 400 });
    }
    const constraints = Array.isArray(body.constraints)
      ? body.constraints.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, 200)).filter(Boolean).slice(0, 12)
      : [];
    const count = body.count === 1 ? 1 : 2;
    const filenamePrompt = typeof body.filenamePrompt === "string" ? body.filenamePrompt.trim().slice(0, 2_000) : undefined;
    const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 8_000) : undefined;
    const images = await generateDesignImages(brief, references, constraints, modification, count, filenamePrompt, prompt);
    return NextResponse.json({ images });
  } catch (error) {
    const message = error instanceof Error ? error.message : "生图失败，请稍后重试。";
    console.error("Design image generation failed:", message);
    return NextResponse.json({ error: message.includes("API") ? "生图服务尚未配置，请检查 GRSai API。" : message }, { status: 500 });
  }
}
