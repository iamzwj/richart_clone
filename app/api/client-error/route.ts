import { NextRequest, NextResponse } from "next/server";
import { isRateLimited } from "@/lib/rate-limit";

export const runtime = "nodejs";

function clientAddress(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function POST(request: NextRequest) {
  if (isRateLimited(`client-error:${clientAddress(request)}`)) {
    return new NextResponse(null, { status: 204 });
  }

  try {
    const body = (await request.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message.trim()) {
      console.error("Client render error:", body.message.trim().slice(0, 500));
    }
  } catch {
    // Error reporting must not affect the user-facing page.
  }

  return new NextResponse(null, { status: 204 });
}
