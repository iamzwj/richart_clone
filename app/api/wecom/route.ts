import { NextRequest, NextResponse } from "next/server";
import { answer } from "@/lib/chat";
import { decryptWecomMessage, encryptWecomMessage, signature, textReply, xmlValue } from "@/lib/wecom";

export const runtime = "nodejs";

function xmlResponse(xml: string, status = 200) {
  return new NextResponse(xml, { status, headers: { "content-type": "application/xml; charset=utf-8" } });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const timestamp = searchParams.get("timestamp") || "";
  const nonce = searchParams.get("nonce") || "";
  const encryptedEcho = searchParams.get("echostr") || "";
  const encryptedSignature = searchParams.get("msg_signature");
  const providedSignature = encryptedSignature || searchParams.get("signature") || "";

  try {
    if (providedSignature !== signature(timestamp, nonce, encryptedSignature ? encryptedEcho : "")) return new NextResponse("forbidden", { status: 403 });
    return new NextResponse(encryptedSignature ? decryptWecomMessage(encryptedEcho) : encryptedEcho);
  } catch (error) {
    console.error("WeCom verification failed:", error instanceof Error ? error.message : "Unknown error");
    return new NextResponse("forbidden", { status: 403 });
  }
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const timestamp = searchParams.get("timestamp") || "";
  const nonce = searchParams.get("nonce") || "";
  const providedSignature = searchParams.get("msg_signature") || searchParams.get("signature") || "";

  try {
    const body = await request.text();
    const encrypted = xmlValue(body, "Encrypt");
    if (providedSignature !== signature(timestamp, nonce, encrypted)) return new NextResponse("forbidden", { status: 403 });

    const message = encrypted ? decryptWecomMessage(encrypted) : body;
    if (xmlValue(message, "MsgType") !== "text") return new NextResponse("success");

    const content = xmlValue(message, "Content");
    const toUser = xmlValue(message, "FromUserName");
    const fromUser = xmlValue(message, "ToUserName");
    if (!content || !toUser || !fromUser) return new NextResponse("success");

    const reply = await answer([{ role: "user", content }]);
    const plainReply = textReply(toUser, fromUser, reply);
    if (!encrypted) return xmlResponse(plainReply);

    const responseNonce = Math.random().toString(36).slice(2, 18);
    const responseTimestamp = String(Math.floor(Date.now() / 1000));
    const responseEncrypted = encryptWecomMessage(plainReply);
    return xmlResponse(`<xml><Encrypt><![CDATA[${responseEncrypted}]]></Encrypt><MsgSignature><![CDATA[${signature(responseTimestamp, responseNonce, responseEncrypted)}]]></MsgSignature><TimeStamp>${responseTimestamp}</TimeStamp><Nonce><![CDATA[${responseNonce}]]></Nonce></xml>`);
  } catch (error) {
    console.error("WeCom message failed:", error instanceof Error ? error.message : "Unknown error");
    return new NextResponse("success");
  }
}
