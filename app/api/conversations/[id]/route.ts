import { NextRequest, NextResponse } from "next/server";
import { appendConversationMessage, getConversation } from "@/lib/conversations";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Context) {
  const { id } = await params;
  const conversation = await getConversation(id);
  return conversation
    ? NextResponse.json({ conversation }, { headers: { "cache-control": "no-store" } })
    : NextResponse.json({ error: "对话不存在。" }, { status: 404 });
}

export async function POST(request: NextRequest, { params }: Context) {
  const { id } = await params;
  try {
    const body = await request.json() as { message?: unknown };
    const conversation = await appendConversationMessage(
      id,
      request.headers.get("x-conversation-token"),
      body.message,
    );
    return conversation
      ? NextResponse.json({ conversation }, { headers: { "cache-control": "no-store" } })
      : NextResponse.json({ error: "对话不存在。" }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法保存对话。";
    return NextResponse.json({ error: message }, { status: message.includes("只读") ? 403 : 400 });
  }
}

