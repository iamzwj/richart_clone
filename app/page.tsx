"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type Brief = {
  title: string;
  subtitle: string;
  copy: string;
  size: string;
  style: string;
};

type GeneratedImage = { url: string };
type Message = { role: "user" | "assistant"; content: string; images?: GeneratedImage[] };
type ReferenceImage = { dataUrl: string; name: string };

const emptyBrief: Brief = { title: "", subtitle: "", copy: "", size: "", style: "" };
const welcome: Message = {
  role: "assistant",
  content: "你好，我是张文杰设计助理。你有什么设计需求可以先跟我说，我可以尝试帮你设计。\n\n你可以跟我说你要做什么，例如：设计一个海报，主标题是xxx，副标题是xxx，下面的文案是xxx，尺寸是：9:16，3d卡通风格。",
};
const fieldLabels: Record<keyof Brief, string> = {
  title: "主标题",
  subtitle: "副标题",
  copy: "文案",
  size: "尺寸",
  style: "风格",
};

function isSatisfied(message: string): boolean {
  return /^(ok|好的|可以|满意|就这样|没问题)[！!。.]?$/i.test(message.trim());
}
function readImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) return Promise.reject(new Error("请上传图片文件。"));
  if (file.size > 4 * 1024 * 1024) return Promise.reject(new Error("参考图不能超过 4MB。"));

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("参考图读取失败，请重试。"));
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result)
      : reject(new Error("参考图读取失败，请重试。"));
    reader.readAsDataURL(file);
  });
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([welcome]);
  const [brief, setBrief] = useState<Brief>(emptyBrief);
  const [input, setInput] = useState("");
  const [reference, setReference] = useState<ReferenceImage | null>(null);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [mode, setMode] = useState<"collect" | "review">("collect");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<GeneratedImage | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const name = process.env.NEXT_PUBLIC_CLONE_NAME || "张文杰";
  const assistantName = `${name}的设计助理`;

  useEffect(() => {
    const element = endRef.current;
    if (!element || typeof element.scrollIntoView !== "function") return;
    try {
      element.scrollIntoView({ behavior: "smooth", block: "end" });
    } catch {
      element.scrollIntoView();
    }
  }, [messages, pending, error]);

  async function extractBrief(message: string, current: Brief): Promise<{ brief: Brief; missing: (keyof Brief)[] }> {
    const response = await fetch("/api/design/brief", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, brief: current }),
    });
    const data = await response.json().catch(() => ({})) as {
      brief?: Brief;
      missing?: (keyof Brief)[];
      error?: string;
    };
    if (!response.ok || !data.brief || !data.missing) {
      throw new Error(data.error || "暂时无法读取需求，请稍后重试。");
    }
    return { brief: data.brief, missing: data.missing };
  }

  async function createImages(
    nextBrief: Brief,
    references: string[],
    modification?: string,
    count = 2,
  ): Promise<GeneratedImage[]> {
    const response = await fetch("/api/design/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brief: nextBrief, references, modification, count }),
    });
    const data = await response.json().catch(() => ({})) as { images?: GeneratedImage[]; error?: string };
    if (!response.ok || !data.images?.length) {
      throw new Error(data.error || "生图失败，请稍后重试。");
    }
    return data.images;
  }

  async function generate(nextBrief: Brief, modification?: string) {
    setPending(true);
    setError("");
    setMessages((current) => [
      ...current,
      { role: "assistant", content: modification ? "收到，我正在根据你的修改方向重新设计…" : "信息已收齐，我开始为你设计，请稍等…" },
    ]);

    try {
      const sources = reference
        ? [reference.dataUrl]
        : generatedImages.map((image) => image.url).slice(0, 2);

      const images = modification && sources.length > 1
        ? (await Promise.all(sources.map((source) => createImages(nextBrief, [source], modification, 1)))).flat()
        : await createImages(nextBrief, sources, modification, 2);

      const result = images.slice(0, 2);
      setGeneratedImages(result);
      setReference(null);
      setMode("review");
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: result.length > 1
            ? "我为你生成了两张方案。这两个图 ok 么？如果不满意，我可以继续生成，或者你跟我说修改方向。"
            : "我为你生成了一张方案。这张图 ok 么？如果不满意，我可以继续生成，或者你跟我说修改方向。",
          images: result,
        },
      ]);
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "生图失败，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const content = input.trim();
    if (!content || pending) return;

    setMessages((current) => [...current, { role: "user", content }]);
    setInput("");
    setError("");

    if (mode === "review" && isSatisfied(content)) {
      setMessages((current) => [...current, { role: "assistant", content: "太好了。如果还需要新的尺寸、文案或风格，直接告诉我修改方向就可以。" }]);
      return;
    }

    setPending(true);
    try {
      const extracted = await extractBrief(content, brief);
      setBrief(extracted.brief);

      if (mode === "collect" && extracted.missing.length) {
        const nextField = extracted.missing[0];
        setMessages((current) => [
          ...current,
          { role: "assistant", content: `请问${fieldLabels[nextField]}是什么呢？` },
        ]);
        return;
      }

      setPending(false);
      await generate(extracted.brief, mode === "review" ? content : undefined);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "暂时无法读取需求，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  async function selectReference(file?: File) {
    if (!file) return;
    try {
      setError("");
      const dataUrl = await readImage(file);
      setReference({ dataUrl, name: file.name });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "参考图读取失败，请重试。");
    }
  }

  function resetConversation() {
    if (pending) return;
    setMessages([welcome]);
    setBrief(emptyBrief);
    setReference(null);
    setGeneratedImages([]);
    setMode("collect");
    setInput("");
    setError("");
  }

  return (
    <main className="wechat-page">
      <section className="wechat-window" aria-label={`与${assistantName}对话`}>
        <header className="chat-header">
          <div className="header-spacer" aria-hidden="true" />
          <div className="contact">
            <h1 aria-live="polite">{pending ? "对方正在输入…" : assistantName}</h1>
          </div>
          <button className="new-chat" type="button" disabled={pending} onClick={resetConversation} aria-label="新对话" title="新对话">↻</button>
        </header>

        <div className="conversation" role="log" aria-label="对话记录" aria-live="polite">
          {messages.map((message, index) => (
            <article className={`chat-row ${message.role}`} key={`${message.role}-${index}`}>
              <div className="avatar" aria-hidden="true">
                {message.role === "assistant" ? <img src="/zhangwenjie-avatar.png" alt="" /> : "我"}
              </div>
              <div className="message-content">
                {message.content && <div className="bubble">{message.content}</div>}
                {message.images?.length ? (
                  <div className="image-gallery">
                    {message.images.map((image, imageIndex) => (
                      <figure key={image.url}>
                        <button type="button" className="image-preview" onClick={() => setPreview(image)} aria-label={`预览生成图 ${imageIndex + 1}`}>
                          <img src={image.url} alt={`生成的设计方案 ${imageIndex + 1}`} />
                        </button>
                        <figcaption>
                          <span>方案 {imageIndex + 1}</span>
                          <a href={`/api/design/download?url=${encodeURIComponent(image.url)}`}>下载</a>
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                ) : null}
              </div>
            </article>
          ))}
          {pending && <article className="chat-row assistant typing-row" aria-label="对方正在输入">
            <div className="avatar" aria-hidden="true"><img src="/zhangwenjie-avatar.png" alt="" /></div>
            <div className="bubble typing"><i /><i /><i /></div>
          </article>}
          {error && <p className="error" role="alert">{error}</p>}
          <div ref={endRef} />
        </div>

        <form onSubmit={send} className="composer">
          {reference && <div className="reference-preview">
            <img src={reference.dataUrl} alt="待参考的上传图片" />
            <span>{reference.name}</span>
            <button type="button" onClick={() => setReference(null)} aria-label="移除参考图">×</button>
          </div>}
          <div className="composer-row">
            <input ref={fileInputRef} className="file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { void selectReference(event.target.files?.[0]); event.currentTarget.value = ""; }} />
            <button className="upload" type="button" disabled={pending} onClick={() => fileInputRef.current?.click()} aria-label="上传参考图" title="上传参考图">＋</button>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
              aria-label="设计需求"
              placeholder={mode === "review" ? "告诉我你想修改什么…" : "输入主标题、副标题、文案、尺寸和风格…"}
              rows={1}
              maxLength={2000}
              disabled={pending}
            />
            <button className="send" type="submit" disabled={pending || !input.trim()}>发送</button>
          </div>
        </form>
      </section>

      {preview && <div className="preview-modal" role="dialog" aria-modal="true" aria-label="图片预览" onClick={() => setPreview(null)}>
        <div className="preview-card" onClick={(event) => event.stopPropagation()}>
          <button type="button" className="close-preview" onClick={() => setPreview(null)} aria-label="关闭预览">×</button>
          <img src={preview.url} alt="生成的设计方案预览" />
          <a href={`/api/design/download?url=${encodeURIComponent(preview.url)}`}>下载图片</a>
        </div>
      </div>}
    </main>
  );
}
