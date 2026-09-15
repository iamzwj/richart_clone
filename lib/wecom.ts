import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const BLOCK_SIZE = 32;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function getKey(): Buffer {
  const encodingKey = required("WECHAT_WORK_ENCODING_AES_KEY");
  if (!/^[A-Za-z0-9]{43}$/.test(encodingKey)) {
    throw new Error("WECHAT_WORK_ENCODING_AES_KEY must be 43 alphanumeric characters.");
  }
  return Buffer.from(`${encodingKey}=`, "base64");
}

function pkcs7Pad(input: Buffer): Buffer {
  const padding = BLOCK_SIZE - (input.length % BLOCK_SIZE);
  return Buffer.concat([input, Buffer.alloc(padding, padding)]);
}

function pkcs7Unpad(input: Buffer): Buffer {
  const padding = input.at(-1);
  if (!padding || padding > BLOCK_SIZE || input.subarray(-padding).some((byte) => byte !== padding)) {
    throw new Error("Invalid WeCom PKCS#7 padding.");
  }
  return input.subarray(0, -padding);
}

export function signature(timestamp: string, nonce: string, encrypted = ""): string {
  return createHash("sha1")
    .update([required("WECHAT_WORK_TOKEN"), timestamp, nonce, encrypted].filter(Boolean).sort().join(""))
    .digest("hex");
}

export function encryptWecomMessage(xml: string): string {
  const key = getKey();
  const corpId = required("WECHAT_WORK_CORP_ID");
  const message = Buffer.from(xml);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(message.length);
  const plaintext = pkcs7Pad(Buffer.concat([randomBytes(16), length, message, Buffer.from(corpId)]));
  const cipher = createCipheriv("aes-256-cbc", key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]).toString("base64");
}

export function decryptWecomMessage(encrypted: string): string {
  const key = getKey();
  const decipher = createDecipheriv("aes-256-cbc", key, key.subarray(0, 16));
  decipher.setAutoPadding(false);
  const plaintext = pkcs7Unpad(Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]));
  const length = plaintext.readUInt32BE(16);
  const xmlEnd = 20 + length;
  const corpId = plaintext.subarray(xmlEnd).toString("utf8");
  if (corpId !== required("WECHAT_WORK_CORP_ID")) throw new Error("WeCom Corp ID mismatch.");
  return plaintext.subarray(20, xmlEnd).toString("utf8");
}

export function xmlValue(xml: string, element: string): string {
  const match = xml.match(new RegExp(`<${element}><!\\[CDATA\\[(.*?)\\]\\]><\\/${element}>|<${element}>(.*?)<\\/${element}>`, "s"));
  return (match?.[1] ?? match?.[2] ?? "").trim();
}

export function escapeXml(value: string): string {
  return value.replace(/[<>&'\"]/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;",
  })[character] as string);
}

export function textReply(toUser: string, fromUser: string, content: string): string {
  return `<xml><ToUserName><![CDATA[${toUser}]]></ToUserName><FromUserName><![CDATA[${fromUser}]]></FromUserName><CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[${content.replace(/]]>/g, "]]&gt;")}]]></Content></xml>`;
}
