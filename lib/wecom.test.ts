import assert from "node:assert/strict";
import test from "node:test";
import { decryptWecomMessage, encryptWecomMessage, signature, xmlValue } from "./wecom";

process.env.WECHAT_WORK_TOKEN = "test-token";
process.env.WECHAT_WORK_ENCODING_AES_KEY = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
process.env.WECHAT_WORK_CORP_ID = "ww-test-corp";

test("encrypts and decrypts an Enterprise WeChat XML message", () => {
  const xml = "<xml><Content><![CDATA[你好，阿Jay]]></Content></xml>";
  const encrypted = encryptWecomMessage(xml);
  assert.notEqual(encrypted, xml);
  assert.equal(decryptWecomMessage(encrypted), xml);
});

test("generates a stable callback signature and reads CDATA", () => {
  assert.equal(signature("1710000000", "nonce", "cipher"), signature("1710000000", "nonce", "cipher"));
  assert.equal(xmlValue("<xml><Content><![CDATA[hello]]></Content></xml>", "Content"), "hello");
});
