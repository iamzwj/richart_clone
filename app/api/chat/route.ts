import { NextRequest, NextResponse } from "next/server";
import { answerStream, type ChatMessage } from "@/lib/chat";
import { isRateLimited } from "@/lib/rate-limit";

export const runtime = "nodejs";

function clientAddress(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function POST(request: NextRequest) {
  if (isRateLimited(`chat:${clientAddress(request)}`)) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试。" }, { status: 429 });
  }

  try {
    const body = (await request.json()) as { messages?: unknown };
    if (!Array.isArray(body.messages)) {
      return NextResponse.json({ error: "消息格式不正确。" }, { status: 400 });
    }

    const completion = await answerStream(body.messages as ChatMessage[]);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of completion) {
            const delta = chunk.choices[0]?.delta.content;
            if (delta) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`));
            }
          }
          controller.enqueue(encoder.encode("data: {\"done\":true}\n\n"));
        } catch (error) {
          console.error("Chat stream failed:", error instanceof Error ? error.message : "Unknown error");
          controller.enqueue(encoder.encode("data: {\"error\":\"暂时无法回复，请稍后重试。\"}\n\n"));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "content-type": "text/event-stream; charset=utf-8",
        "x-accel-buffering": "no",
      },
    });
  } catch (error) {
    console.error("Chat request failed:", error instanceof Error ? error.message : "Unknown error");
    const message = error instanceof Error && error.message.includes("GRSAI_API_KEY")
      ? "服务尚未配置模型密钥。"
      : "暂时无法回复，请稍后重试。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
