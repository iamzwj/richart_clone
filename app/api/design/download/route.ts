import { NextRequest, NextResponse } from "next/server";
import { isAllowedImageUrl } from "@/lib/image";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const source = request.nextUrl.searchParams.get("url");
  if (!source || !isAllowedImageUrl(source)) {
    return NextResponse.json({ error: "图片地址无效。" }, { status: 400 });
  }

  try {
    const response = await fetch(source, { cache: "no-store" });
    if (!response.ok) return NextResponse.json({ error: "图片暂时无法下载。" }, { status: 502 });

    const contentType = response.headers.get("content-type") || "image/png";
    const extension = contentType.includes("webp") ? "webp" : contentType.includes("jpeg") ? "jpg" : "png";
    return new NextResponse(response.body, {
      headers: {
        "content-type": contentType,
        "content-disposition": `attachment; filename="zhangwenjie-design.${extension}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "图片暂时无法下载。" }, { status: 502 });
  }
}

