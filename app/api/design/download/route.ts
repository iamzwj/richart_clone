import { NextRequest, NextResponse } from "next/server";
import { isAllowedImageUrl, readGeneratedImage } from "@/lib/image";

export const runtime = "nodejs";

function attachmentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/[\\"]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(request: NextRequest) {
  const savedId = request.nextUrl.searchParams.get("id");
  if (savedId) {
    const image = await readGeneratedImage(savedId);
    if (!image) return NextResponse.json({ error: "图片不存在或已失效。" }, { status: 404 });
    return new NextResponse(new Uint8Array(image.data).buffer, {
      headers: { "content-type": image.contentType, "content-disposition": attachmentDisposition(image.filename), "cache-control": "private, no-store" },
    });
  }
  const source = request.nextUrl.searchParams.get("url");
  if (!source || !isAllowedImageUrl(source)) {
    return NextResponse.json({ error: "图片地址无效。" }, { status: 400 });
  }

  try {
    const response = await fetch(source, { cache: "no-store" });
    if (!response.ok) return NextResponse.json({ error: "图片暂时无法下载。" }, { status: 502 });

    const contentType = response.headers.get("content-type") || "image/png";
    const extension = contentType.includes("webp") ? "webp" : contentType.includes("jpeg") ? "jpg" : "png";
    const inline = request.nextUrl.searchParams.get("inline") === "1";
    return new NextResponse(response.body, {
      headers: {
        "content-type": contentType,
        "content-disposition": inline ? "inline" : `attachment; filename="zhangwenjie-design.${extension}"`,
        "cache-control": inline ? "public, max-age=3600" : "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "图片暂时无法下载。" }, { status: 502 });
  }
}
