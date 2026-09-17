# 张文杰设计助理

一个可公开访问、也可接入企业微信的数字分身。网页与企业微信复用相同的人设资料和模型调用层。

## 已包含

- 适合直接分享的移动端网页聊天入口
- 服务端通过 GRSai 的 OpenAI-compatible Chat Completions API 调用可配置的模型；浏览器永远拿不到 API Key
- `content/profile.md` 作为可编辑的人设/知识起点
- 企业微信 URL 验证、明文消息和加密消息回调（`/api/wecom`）
- 基础 IP 限流与输入长度限制，避免公开链接被简单刷爆

## 本地运行

```bash
npm install
cp .env.example .env.local
npm run dev
```

在 `.env.local` 填入 `GRSAI_API_KEY`，然后访问 `http://localhost:3000`。默认模型是响应更快的 `gemini-3.1-flash-lite`；不要将 `.env.local` 提交到 Git。

## 让它像你，而不是泛用聊天机器人

编辑 [`content/profile.md`](./content/profile.md)：加入你的简介、已公开项目、常见问答、表达方式，以及绝不应回答的内容。这个文件是唯一的人设事实来源；没有写入的个人事实，机器人会明确说不知道。

## 部署为分享链接（推荐先完成这一步）

1. 将仓库推送到 GitHub。
2. 在 Vercel 导入该仓库（框架会自动识别为 Next.js）。
3. 在 Vercel 的 Environment Variables 填写 `GRSAI_API_KEY`，可选填写 `GRSAI_BASE_URL` 和 `GRSAI_MODEL`。
4. 重新部署，得到例如 `https://richart-clone.vercel.app` 的链接，即可分享。

这是最短路径：企业微信需要一个可从公网访问的 HTTPS 回调地址，所以先部署网页也正好提供了该地址。

## 接入企业微信

部署完成后，在企业微信管理后台创建应用并配置“接收消息”：

- URL：`https://你的域名/api/wecom`
- Token：自定义一个随机字符串，并同步填写到 `WECHAT_WORK_TOKEN`
- EncodingAESKey：由企业微信生成，并同步填写到 `WECHAT_WORK_ENCODING_AES_KEY`
- `WECHAT_WORK_CORP_ID`：企业 ID

填好三个企业微信变量后重新部署，再保存企业微信配置。路由会校验企业微信签名，并支持加密消息。当前版本只自动回复文本消息；图片、语音、群聊上下文和成员权限控制尚未接入。

## 腾讯云自动部署：`zwj.17design.fun`

仓库已经包含 [GitHub Actions 工作流](./.github/workflows/deploy.yml)。完成一次服务器初始化后，每次推送到 `main` 都会自动测试、构建、上传新版本并重启服务。

### 一次性初始化

1. 在 DNSPod 为 `zwj.17design.fun` 添加 A 记录，指向腾讯云服务器公网 IP。
2. 为服务器创建**专用部署密钥**，将公钥加入部署用户的 `~/.ssh/authorized_keys`。不要复用 GitHub 登录私钥。
3. 以 root 登录服务器，上传并执行 `server/bootstrap.sh`：

   ```bash
   DOMAIN=zwj.17design.fun EMAIL=you@example.com bash bootstrap.sh
   ```

   脚本会安装 Node.js 20、Nginx、systemd 服务和 Let's Encrypt HTTPS 证书；仅支持 Ubuntu/Debian。

### GitHub Actions Secrets

在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 添加：

| Name | Value |
| --- | --- |
| `DEPLOY_HOST` | 腾讯云服务器公网 IP |
| `DEPLOY_USER` | 可执行无密码 `sudo` 的部署用户 |
| `DEPLOY_SSH_KEY` | 专用部署私钥全文 |
| `DEPLOY_HOST_FINGERPRINT` | 服务器 SSH ED25519 指纹，例如 `SHA256:...` |
| `DEPLOY_PORT` | 可选，默认 `22` |
| `GRSAI_API_KEY` | GRSai API 密钥 |

可选 Repository Variables：`GRSAI_BASE_URL`（默认 `https://grsaiapi.com`）和 `GRSAI_MODEL`（默认 `gemini-3.1-flash-lite`）。Secrets 不会写入仓库，也不会出现在部署日志中。

## 生产注意事项

- 当前限流存于进程内存，适合 MVP。多实例部署前请改为 Vercel KV、Upstash Redis 或数据库限流。
- 公开链接会产生模型费用。若仅面向特定人群，应在入口增加登录、邀请码或 Cloudflare WAF。
- 应用本身不会持久化聊天记录；对话仍会发送给 GRSai，因此上线前应根据其数据保留与合规政策进行确认。

## Verify

```bash
npm run typecheck
npm run build
```

## 设计顾问版本

首页提供需求梳理、方案评审、视觉方向和 AI 提示词四个入口，点击后可编辑问题再发送。支持新对话、中文输入法和清晰的模型配置错误提示。

设计方向已补充在 `content/profile.md`，重点为视觉设计、AI 设计、海报、详情页及 AI 工具。现有姓名与经历沿用原仓库，发布前请核实；修改资料后重启服务。当前只支持文字描述，尚不支持上传图片或直接生成图片。
