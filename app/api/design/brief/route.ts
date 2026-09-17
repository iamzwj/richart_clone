import { NextRequest, NextResponse } from "next/server";
import {
  emptyDesignBrief,
  extractDesignBrief,
  missingFields,
  normaliseBrief,
} from "@/lib/design";
import { isRateLimited } from "@/lib/rate-limit";

export const runtime = "nodejs";

function clientAddress(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function POST(request: NextRequest) {
  if (isRateLimited(`design-brief:${clientAddress(request)}`)) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试。" }, { status: 429 });
  }

  try {
    const body = await request.json() as { message?: unknown; brief?: unknown };
    if (typeof body.message !== "string" || !body.message.trim()) {
      return NextResponse.json({ error: "请输入设计需求。" }, { status: 400 });
    }

    const current = normaliseBrief(
      body.brief && typeof body.brief === "object" ? body.brief as Record<string, unknown> : emptyDesignBrief,
    );
    const brief = await extractDesignBrief(body.message, current);
    return NextResponse.json({ brief, missing: missingFields(brief) });
  } catch (error) {
    console.error("Design brief extraction failed:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "暂时无法读取需求，请稍后重试。" }, { status: 500 });
  }
}

