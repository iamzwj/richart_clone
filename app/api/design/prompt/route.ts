import { NextRequest, NextResponse } from "next/server";
import { normaliseBrief } from "@/lib/design";
import { buildDesignPrompt } from "@/lib/image";
import { isRateLimited } from "@/lib/rate-limit";

export const runtime = "nodejs";

function clientAddress(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function POST(request: NextRequest) {
  if (isRateLimited(`design-prompt:${clientAddress(request)}`)) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试。" }, { status: 429 });
  }

  try {
    const body = await request.json() as { brief?: unknown; constraints?: unknown; modification?: unknown; hasReference?: unknown };
    const brief = normaliseBrief(body.brief && typeof body.brief === "object" ? body.brief as Record<string, unknown> : {});
    const constraints = Array.isArray(body.constraints)
      ? body.constraints.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, 200)).filter(Boolean).slice(0, 12)
      : [];
    const modification = typeof body.modification === "string" ? body.modification.trim().slice(0, 2_000) : undefined;
    return NextResponse.json({ prompt: buildDesignPrompt(brief, constraints, modification, Boolean(body.hasReference && modification)) });
  } catch {
    return NextResponse.json({ error: "暂时无法生成设计提示词，请稍后重试。" }, { status: 500 });
  }
}
