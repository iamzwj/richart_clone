import { NextRequest, NextResponse } from "next/server";
import { normaliseBrief } from "@/lib/design";
import { generateDesignImages, isAllowedImageUrl } from "@/lib/image";
import { isRateLimited } from "@/lib/rate-limit";

export const runtime = "nodejs";

function clientAddress(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
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
    };
    const brief = normaliseBrief(
      body.brief && typeof body.brief === "object" ? body.brief as Record<string, unknown> : {},
    );
    if (Object.values(brief).some((value) => !value)) {
      return NextResponse.json({ error: "请先补全主标题、副标题、文案、尺寸和风格。" }, { status: 400 });
    }

    const references = Array.isArray(body.references)
      ? body.references.filter((item): item is string => typeof item === "string" && (item.startsWith("data:image/") || isAllowedImageUrl(item))).slice(0, 1)
      : [];
    const modification = typeof body.modification === "string" ? body.modification.trim().slice(0, 2_000) : undefined;
    const constraints = Array.isArray(body.constraints)
      ? body.constraints.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, 200)).filter(Boolean).slice(0, 12)
      : [];
    const count = body.count === 1 ? 1 : 2;
    const images = await generateDesignImages(brief, references, constraints, modification, count);
    return NextResponse.json({ images });
  } catch (error) {
    const message = error instanceof Error ? error.message : "生图失败，请稍后重试。";
    console.error("Design image generation failed:", message);
    return NextResponse.json({ error: message.includes("API") ? "生图服务尚未配置，请检查 GRSai API。" : message }, { status: 500 });
  }
}
