# Richart Clone

一个可公开访问、也可接入企业微信的数字分身。网页与企业微信复用相同的人设资料和模型调用层。

## 已包含

- 适合直接分享的移动端网页聊天入口
- 服务端 OpenAI Responses API 调用；浏览器永远拿不到 API Key
- `content/profile.md` 作为可编辑的人设/知识起点
- 企业微信 URL 验证、明文消息和加密消息回调（`/api/wecom`）
- 基础 IP 限流与输入长度限制，避免公开链接被简单刷爆

## 本地运行

```bash
npm install
cp .env.example .env.local
npm run dev
```

在 `.env.local` 填入 `OPENAI_API_KEY`，然后访问 `http://localhost:3000`。不要将 `.env.local` 提交到 Git。

## 让它像你，而不是泛用聊天机器人

编辑 [`content/profile.md`](./content/profile.md)：加入你的简介、已公开项目、常见问答、表达方式，以及绝不应回答的内容。这个文件是唯一的人设事实来源；没有写入的个人事实，机器人会明确说不知道。

## 部署为分享链接（推荐先完成这一步）

1. 将仓库推送到 GitHub。
2. 在 Vercel 导入该仓库（框架会自动识别为 Next.js）。
3. 在 Vercel 的 Environment Variables 填写 `OPENAI_API_KEY`，可选填写 `OPENAI_MODEL`。
4. 重新部署，得到例如 `https://richart-clone.vercel.app` 的链接，即可分享。

这是最短路径：企业微信需要一个可从公网访问的 HTTPS 回调地址，所以先部署网页也正好提供了该地址。

## 接入企业微信

部署完成后，在企业微信管理后台创建应用并配置“接收消息”：

- URL：`https://你的域名/api/wecom`
- Token：自定义一个随机字符串，并同步填写到 `WECHAT_WORK_TOKEN`
- EncodingAESKey：由企业微信生成，并同步填写到 `WECHAT_WORK_ENCODING_AES_KEY`
- `WECHAT_WORK_CORP_ID`：企业 ID

填好三个企业微信变量后重新部署，再保存企业微信配置。路由会校验企业微信签名，并支持加密消息。当前版本只自动回复文本消息；图片、语音、群聊上下文和成员权限控制尚未接入。

## 生产注意事项

- 当前限流存于进程内存，适合 MVP。多实例部署前请改为 Vercel KV、Upstash Redis 或数据库限流。
- 公开链接会产生模型费用。若仅面向特定人群，应在入口增加登录、邀请码或 Cloudflare WAF。
- 对话请求使用 `store: false`，应用本身不会保存聊天记录；仍应根据你的组织合规要求审查模型供应商的数据政策。

## Verify

```bash
npm run typecheck
npm run build
```
