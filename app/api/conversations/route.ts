import { NextRequest, NextResponse } from "next/server";
import { createConversation, listConversations } from "@/lib/conversations";
import { isRateLimited } from "@/lib/rate-limit";

export const runtime = "nodejs";

function clientAddress(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function GET() {
  return NextResponse.json({ conversations: await listConversations() }, {
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  if (isRateLimited(`conversation-create:${clientAddress(request)}`, 12)) {
    return NextResponse.json({ error: "新建对话过于频繁，请稍后再试。" }, { status: 429 });
  }
  const result = await createConversation();
  return NextResponse.json(result, { status: 201, headers: { "cache-control": "no-store" } });
}

