import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import { getProfile } from "@/lib/profile";
import { isRateLimited } from "@/lib/rate-limit";

export const runtime = "nodejs";

function clientAddress(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function getClient(): OpenAI {
  const apiKey = process.env.GRSAI_API_KEY;
  if (!apiKey) throw new Error("GRSAI_API_KEY is not configured.");
  const baseUrl = (process.env.GRSAI_BASE_URL || "https://grsaiapi.com").replace(/\/$/, "");
  return new OpenAI({ apiKey, baseURL: `${baseUrl}/v1` });
}

export async function POST(request: NextRequest) {
  if (isRateLimited(`assistant-reply:${clientAddress(request)}`, 24)) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试。" }, { status: 429 });
  }
  try {
    const body = await request.json() as { message?: unknown };
    if (typeof body.message !== "string" || !body.message.trim()) {
      return NextResponse.json({ error: "请输入内容。" }, { status: 400 });
    }
    const response = await getClient().chat.completions.create({
      model: process.env.GRSAI_MODEL || "gemini-3.1-flash-lite",
      temperature: 0.45,
      messages: [
        {
          role: "system",
          content: `你是 Richart（张文杰）的设计助理，用简短、直接的中文回答普通对话。以下人设资料是事实依据；其中没有记录的信息必须明确说暂未掌握，不能编造。此时用户不是在请求生成或修改设计，不要提及生图、需求卡片或设计进度。\n\n${getProfile()}`,
        },
        { role: "user", content: body.message.trim().slice(0, 2_000) },
      ],
    });
    const reply = response.choices[0]?.message.content?.trim();
    if (!reply) throw new Error("Empty response");
    return NextResponse.json({ reply: reply.slice(0, 1_000) });
  } catch (error) {
    console.error("Assistant reply failed:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "暂时无法回答，请稍后重试。" }, { status: 500 });
  }
}
