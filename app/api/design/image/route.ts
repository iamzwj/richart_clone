import { NextRequest, NextResponse } from "next/server";
import { readGeneratedImage } from "@/lib/image";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id") || "";
  const image = await readGeneratedImage(id);
  return image
    ? new NextResponse(new Uint8Array(image.data).buffer, { headers: { "content-type": image.contentType, "cache-control": "public, max-age=31536000, immutable" } })
    : NextResponse.json({ error: "图片不存在或已失效。" }, { status: 404 });
}
