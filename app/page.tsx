"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type Brief = {
  title: string;
  subtitle: string;
  copy: string;
  size: string;
  style: string;
};

type FieldSource = "user" | "ai";
type GeneratedImage = { url: string };
type Message = {
  role: "user" | "assistant";
  content: string;
  images?: GeneratedImage[];
  referenceThumbnail?: string;
  brief?: Brief;
  sources?: Partial<Record<keyof Brief, FieldSource>>;
  constraints?: string[];
};
type ReferenceImage = { dataUrl: string; thumbnail: string; name: string };
type ConversationSummary = { id: string; title: string; createdAt: string; updatedAt: string; messageCount: number };
type ActiveConversation = { id: string; token: string };

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
const fieldPlaceholders: Record<keyof Brief, string> = {
  title: "例如：有问题找助理",
  subtitle: "例如：24 小时在线响应",
  copy: "例如：说出你的问题，马上获得帮助",
  size: "例如：9:16",
  style: "输入或选择一种风格",
};
const stylePresets = ["3D 卡通", "写实风", "极简平面", "国潮插画", "轻奢质感", "赛博朋克"];

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

function createSquareThumbnail(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const side = Math.min(image.naturalWidth, image.naturalHeight);
      const sourceX = (image.naturalWidth - side) / 2;
      const sourceY = (image.naturalHeight - side) / 2;
      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 160;
      const context = canvas.getContext("2d");
      if (!context) return reject(new Error("参考图缩略图生成失败。"));
      context.drawImage(image, sourceX, sourceY, side, side, 0, 0, 160, 160);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    image.onerror = () => reject(new Error("参考图缩略图生成失败。"));
    image.src = dataUrl;
  });
}

function explicitSize(message: string): string {
  const match = message.match(/\d{1,2}\s*[:：]\s*\d{1,2}|\d{3,4}\s*[x×*]\s*\d{3,4}/);
  return match ? match[0].replace(/[：]/g, ":").replace(/[×*]/g, "x").replace(/\s/g, "") : "";
}

function applyRecommendations(brief: Brief, message: string): { brief: Brief; fields: (keyof Brief)[] } {
  const delegated = /(都行|你看着|随便|没要求)/.test(message);
  const isPoster = /海报|poster/i.test(message) || /海报|poster/i.test(brief.title);
  const next = { ...brief };
  const fields: (keyof Brief)[] = [];
  const delegatedValue = (value: string) => /(都行|你看着|随便|没要求)/.test(value);
  if (!next.size && isPoster) {
    next.size = "9:16";
    fields.push("size");
  }
  if ((!next.size || delegatedValue(next.size)) && (delegated || /(?:尺寸|比例)[^。！!，,]{0,12}(?:都行|你看着|随便|没要求)/.test(message))) {
    next.size = "9:16";
    fields.push("size");
  }
  if ((!next.style || delegatedValue(next.style)) && (delegated || /风格[^。！!，,]{0,12}(?:都行|你看着|随便|没要求)/.test(message))) {
    next.style = "现代、简洁、专业的商业海报风格";
    fields.push("style");
  }
  return { brief: next, fields };
}

function applyPosterSizeDefault(messages: Message[]): Message[] {
  const isPosterConversation = messages.some((message) => message.role === "user" && /海报|poster/i.test(message.content));
  if (!isPosterConversation) return messages;
  return messages.map((message) => message.brief && !message.brief.size ? {
    ...message,
    brief: { ...message.brief, size: "9:16" },
    sources: { ...message.sources, size: "ai" },
  } : message);
}

function updateConstraints(message: string, current: string[]): string[] {
  const additions = [
    [/不要太写实|避免写实/, "避免写实摄影风格"],
    [/不要科技感|避免科技感/, "避免科技感"],
    [/人(?:物)?不要太多|减少人物/, "避免人物过多"],
    [/彩带.*少|少.*彩带/, "少量使用彩带装饰"],
  ].filter(([pattern]) => (pattern as RegExp).test(message)).map(([, value]) => value as string);
  return [...new Set([...current, ...additions])];
}

function formatConversationTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "刚刚" : new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function WelcomeMessage() {
  return <div className="welcome-bubble">
    <p className="welcome-greeting">你好，我是<strong>张文杰设计助理</strong>。</p>
    <p className="welcome-intro">你有什么设计需求可以先跟我说，我可以尝试帮你设计。</p>
    <div className="welcome-example">
      <span>例如这样描述</span>
      <p>设计一个海报</p>
      <p>主标题：xxx　副标题：xxx</p>
      <p>文案：xxx　尺寸：9:16　风格：3D 卡通</p>
    </div>
  </div>;
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([welcome]);
  const [brief, setBrief] = useState<Brief>(emptyBrief);
  const [sources, setSources] = useState<Partial<Record<keyof Brief, FieldSource>>>({});
  const [constraints, setConstraints] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [reference, setReference] = useState<ReferenceImage | null>(null);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [writeToken, setWriteToken] = useState<string | null>(null);
  const [conversationList, setConversationList] = useState<ConversationSummary[]>([]);
  const [readOnly, setReadOnly] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [mode, setMode] = useState<"collect" | "review">("collect");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<GeneratedImage | null>(null);
  const [editingField, setEditingField] = useState<keyof Brief | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [briefDrafts, setBriefDrafts] = useState<Partial<Brief>>({});
  const [draggingReference, setDraggingReference] = useState(false);
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

  async function refreshConversationList() {
    const response = await fetch("/api/conversations", { cache: "no-store" });
    const data = await response.json().catch(() => ({})) as { conversations?: ConversationSummary[] };
    if (response.ok && data.conversations) setConversationList(data.conversations);
  }

  async function openConversation(id: string, token: string | null) {
    setLoadingConversation(true);
    try {
      const response = await fetch(`/api/conversations/${id}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as { conversation?: { messages?: Message[] } };
      if (!response.ok || !data.conversation) throw new Error("无法读取对话记录。");
      setConversationId(id);
      setWriteToken(token);
      setReadOnly(!token);
      const loadedMessages = applyPosterSizeDefault(data.conversation.messages?.length ? data.conversation.messages : [welcome]);
      const latestBrief = [...loadedMessages].reverse().find((message) => message.brief);
      setMessages(loadedMessages);
      setBrief(latestBrief?.brief || emptyBrief);
      setSources(latestBrief?.sources || {});
      setConstraints(latestBrief?.constraints || []);
      setReference(null);
      setGeneratedImages([]);
      setMode("review");
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "无法读取对话记录。");
    } finally {
      setLoadingConversation(false);
    }
  }

  useEffect(() => {
    void refreshConversationList();
    const timer = window.setInterval(() => { void refreshConversationList(); }, 3_000);
    const saved = window.sessionStorage.getItem("zhangwenjie-design-conversation");
    if (saved) {
      try {
        const active = JSON.parse(saved) as ActiveConversation;
        if (active.id && active.token) void openConversation(active.id, active.token);
      } catch {
        window.sessionStorage.removeItem("zhangwenjie-design-conversation");
      }
    }
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!conversationId || !readOnly) return;
    const timer = window.setInterval(() => { void openConversation(conversationId, null); }, 3_000);
    return () => window.clearInterval(timer);
  }, [conversationId, readOnly]);

  async function ensureConversation(): Promise<ActiveConversation> {
    if (conversationId && writeToken) return { id: conversationId, token: writeToken };
    const response = await fetch("/api/conversations", { method: "POST" });
    const data = await response.json().catch(() => ({})) as { conversation?: { id: string }; token?: string; error?: string };
    if (!response.ok || !data.conversation?.id || !data.token) throw new Error(data.error || "无法创建对话。");
    const active = { id: data.conversation.id, token: data.token };
    window.sessionStorage.setItem("zhangwenjie-design-conversation", JSON.stringify(active));
    setConversationId(active.id);
    setWriteToken(active.token);
    setReadOnly(false);
    void refreshConversationList();
    return active;
  }

  async function saveMessage(active: ActiveConversation, message: Message) {
    await fetch(`/api/conversations/${active.id}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-conversation-token": active.token },
      body: JSON.stringify({ message }),
    }).catch(() => undefined);
    void refreshConversationList();
  }

  async function saveUpdatedMessage(active: ActiveConversation, messageIndex: number, message: Message) {
    const response = await fetch(`/api/conversations/${active.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-conversation-token": active.token },
      body: JSON.stringify({ messageIndex, message }),
    });
    if (!response.ok) throw new Error("需求卡片保存失败，请重试。");
    void refreshConversationList();
  }

  async function persistBriefField(messageIndex: number, message: Message, field: keyof Brief, rawValue: string) {
    if (!rawValue.trim() || !message.brief) return;
    const value = rawValue.trim();
    const nextBrief = { ...brief, [field]: value };
    const nextSources = { ...sources, [field]: "user" as FieldSource };
    const updatedMessage = {
      ...message,
      brief: nextBrief,
      sources: nextSources,
    };
    setBrief(nextBrief);
    setSources(nextSources);
    setMessages((current) => current.map((item, index) => index === messageIndex ? updatedMessage : item));
    setBriefDrafts((current) => ({ ...current, [field]: undefined }));
    if (!conversationId || !writeToken) return;
    try {
      await saveUpdatedMessage({ id: conversationId, token: writeToken }, messageIndex, updatedMessage);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "需求卡片保存失败，请重试。");
    }
  }

  async function commitBriefEdit(messageIndex: number, message: Message) {
    if (!editingField) return;
    await persistBriefField(messageIndex, message, editingField, editingValue);
    setEditingField(null);
    setEditingValue("");
  }

  async function generateFromBriefCard(message: Message) {
    const missing = (Object.keys(fieldLabels) as (keyof Brief)[]).filter((field) => !brief[field]);
    if (missing.length) {
      setError("请先填写所有必要信息。");
      return;
    }
    try {
      const active = await ensureConversation();
      await generate(brief, active, undefined, { brief, sources, constraints: message.constraints || constraints });
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "暂时无法开始设计，请稍后重试。");
    }
  }

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
    activeConstraints = constraints,
  ): Promise<GeneratedImage[]> {
    const response = await fetch("/api/design/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brief: nextBrief, references, modification, constraints: activeConstraints, count }),
    });
    const data = await response.json().catch(() => ({})) as { images?: GeneratedImage[]; error?: string };
    if (!response.ok || !data.images?.length) {
      throw new Error(data.error || "生图失败，请稍后重试。");
    }
    return data.images;
  }

  async function generate(
    nextBrief: Brief,
    active: ActiveConversation,
    modification?: string,
    snapshot?: Pick<Message, "brief" | "sources" | "constraints">,
    directReferences?: string[],
  ) {
    setPending(true);
    setError("");
    const progressMessage: Message = {
      role: "assistant",
      content: modification ? "收到，我正在根据你的修改方向重新设计…" : "信息已收齐，我开始为你设计，请稍等…",
      ...snapshot,
    };
    setMessages((current) => [...current, progressMessage]);
    void saveMessage(active, progressMessage);

    try {
      const activeConstraints = snapshot?.constraints || constraints;
      const sources = directReferences || (reference
        ? [reference.dataUrl]
        : generatedImages.map((image) => image.url).slice(0, 2));

      const images = modification && sources.length > 1
        ? (await Promise.all(sources.map((source) => createImages(nextBrief, [source], modification, 1, activeConstraints)))).flat()
        : await createImages(nextBrief, sources, modification, 2, activeConstraints);

      const result = images.slice(0, 2);
      setGeneratedImages(result);
      setReference(null);
      setMode("review");
      const resultMessage: Message = {
        role: "assistant",
        content: result.length > 1
          ? "我为你生成了两张方案。这两个图 ok 么？如果不满意，我可以继续生成，或者你跟我说修改方向。"
          : "我为你生成了一张方案。这张图 ok 么？如果不满意，我可以继续生成，或者你跟我说修改方向。",
        images: result,
      };
      setMessages((current) => [...current, resultMessage]);
      void saveMessage(active, resultMessage);
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "生图失败，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const content = input.trim();
    if (!content || pending || readOnly) return;

    setPending(true);
    try {
      const active = await ensureConversation();
      const selectedReference = reference;
      const userMessage: Message = { role: "user", content, referenceThumbnail: selectedReference?.thumbnail };
      setMessages((current) => [...current, userMessage]);
      void saveMessage(active, userMessage);
      setInput("");
      setError("");
      setReference(null);

      if (selectedReference) {
        const editBrief = { ...emptyBrief, size: explicitSize(content) };
        setPending(false);
        await generate(editBrief, active, content, undefined, [selectedReference.dataUrl]);
        return;
      }

      if (mode === "review" && isSatisfied(content)) {
        const reply: Message = { role: "assistant", content: "太好了。如果还需要新的尺寸、文案或风格，直接告诉我修改方向就可以。" };
        setMessages((current) => [...current, reply]);
        void saveMessage(active, reply);
        return;
      }

      const extracted = await extractBrief(content, brief);
      const recommended = applyRecommendations(extracted.brief, content);
      const nextBrief = recommended.brief;
      const nextConstraints = updateConstraints(content, constraints);
      const nextSources = { ...sources };
      (Object.keys(fieldLabels) as (keyof Brief)[]).forEach((field) => {
        if (recommended.fields.includes(field)) nextSources[field] = "ai";
        else if (nextBrief[field] && nextBrief[field] !== brief[field]) nextSources[field] = "user";
      });
      const missing = (Object.keys(fieldLabels) as (keyof Brief)[]).filter((field) => !nextBrief[field]);
      setBrief(nextBrief);
      setSources(nextSources);
      setConstraints(nextConstraints);

      if (mode === "collect" && missing.length) {
        const question: Message = {
          role: "assistant",
          content: "请填写必要信息，我才能帮你设计。",
          brief: nextBrief,
          sources: nextSources,
          constraints: nextConstraints,
        };
        setMessages((current) => [...current, question]);
        void saveMessage(active, question);
        return;
      }

      setPending(false);
      await generate(nextBrief, active, mode === "review" ? content : undefined, {
        brief: nextBrief,
        sources: nextSources,
        constraints: nextConstraints,
      });
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
      const thumbnail = await createSquareThumbnail(dataUrl);
      setReference({ dataUrl, thumbnail, name: file.name });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "参考图读取失败，请重试。");
    }
  }

  function resetConversation() {
    if (pending) return;
    window.sessionStorage.removeItem("zhangwenjie-design-conversation");
    setConversationId(null);
    setWriteToken(null);
    setReadOnly(false);
    setMessages([welcome]);
    setBrief(emptyBrief);
    setSources({});
    setConstraints([]);
    setReference(null);
    setGeneratedImages([]);
    setMode("collect");
    setInput("");
    setError("");
    setEditingField(null);
    setEditingValue("");
    setBriefDrafts({});
  }

  const latestBriefIndex = messages.reduce((latest, message, index) => message.brief ? index : latest, -1);

  return (
    <main
      className={`workspace ${draggingReference ? "dragging-reference" : ""}`}
      onDragOver={(event) => { event.preventDefault(); if (!readOnly) setDraggingReference(true); }}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDraggingReference(false); }}
      onDrop={(event) => { event.preventDefault(); setDraggingReference(false); if (!readOnly) void selectReference(event.dataTransfer.files?.[0]); }}
    >
      <aside className="conversation-sidebar" aria-label="公开对话列表">
        <div className="sidebar-header">
          <div className="sidebar-title">
            <img src="/zhangwenjie-avatar.png" alt="" />
            <div><h2>对话记录</h2><p>所有访客可查看</p></div>
          </div>
          <button className="new-conversation" type="button" onClick={resetConversation} disabled={pending}>新对话+</button>
        </div>
        <div className="sidebar-list">
          {!conversationList.length ? <p className="empty-list">暂时还没有公开对话。</p> : conversationList.map((conversation) => (
            <button
              type="button"
              className={`conversation-item ${conversation.id === conversationId ? "active" : ""}`}
              key={conversation.id}
              onClick={() => {
                const saved = window.sessionStorage.getItem("zhangwenjie-design-conversation");
                let token: string | null = null;
                if (saved) {
                  try {
                    const active = JSON.parse(saved) as ActiveConversation;
                    if (active.id === conversation.id) token = active.token;
                  } catch { /* Invalid session data should not block read-only viewing. */ }
                }
                void openConversation(conversation.id, token);
              }}
            >
              <strong>{conversation.title}</strong>
              <span>{conversation.messageCount} 条消息 · {formatConversationTime(conversation.updatedAt)}</span>
            </button>
          ))}
        </div>
        <p className="sidebar-note">打开其他人的对话后仅可查看，不能发送或修改。</p>
      </aside>
      <section className="wechat-window" aria-label={`与${assistantName}对话`}>
        <header className="chat-header">
          <div className="header-identity" aria-hidden="true"><img src="/zhangwenjie-avatar.png" alt="" /></div>
          <div className="contact">
            <h1 aria-live="polite">{loadingConversation ? "正在打开对话…" : pending ? "对方正在输入…" : assistantName}</h1>
          </div>
          <div className="header-spacer" aria-hidden="true" />
        </header>

        <div className="conversation" role="log" aria-label="对话记录" aria-live="polite">
          {messages.map((message, index) => (
            <article className={`chat-row ${message.role}`} key={`${message.role}-${index}`}>
              <div className="avatar" aria-hidden="true">
                {message.role === "assistant" ? <img src="/zhangwenjie-avatar.png" alt="" /> : "我"}
              </div>
              <div className="message-content">
                {message.referenceThumbnail && <button type="button" className="message-reference" onClick={() => setPreview({ url: message.referenceThumbnail || "" })} aria-label="预览参考图"><img src={message.referenceThumbnail} alt="用户上传的参考图" /></button>}
                {message.content && (message === welcome ? <WelcomeMessage /> : <div className="bubble">{message.content}</div>)}
                {message.brief && <section className="brief-card" aria-label="当前设计需求">
                  <div className="brief-card-title">当前设计需求</div>
                  {(Object.keys(fieldLabels) as (keyof Brief)[]).map((field) => (
                    <div className={`brief-field ${!message.brief?.[field] && index === latestBriefIndex ? "brief-field-input" : ""}`} key={field}>
                      <span>{fieldLabels[field]}</span>
                      {editingField === field && index === latestBriefIndex ? <input
                        autoFocus
                        value={editingValue}
                        onChange={(event) => setEditingValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void commitBriefEdit(index, message);
                          if (event.key === "Escape") { setEditingField(null); setEditingValue(""); }
                        }}
                        aria-label={`编辑${fieldLabels[field]}`}
                      /> : !message.brief?.[field] && index === latestBriefIndex ? <div className="brief-entry">
                        <input
                          value={briefDrafts[field] ?? ""}
                          placeholder={fieldPlaceholders[field]}
                          onChange={(event) => setBriefDrafts((current) => ({ ...current, [field]: event.target.value }))}
                          onBlur={() => { const value = briefDrafts[field] || ""; if (value.trim()) void persistBriefField(index, message, field, value); }}
                          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void persistBriefField(index, message, field, briefDrafts[field] || ""); } }}
                          aria-label={`填写${fieldLabels[field]}`}
                        />
                        {field === "style" && <div className="style-presets" aria-label="风格预设">
                          {stylePresets.map((preset) => <button type="button" key={preset} onMouseDown={(event) => event.preventDefault()} onClick={() => { void persistBriefField(index, message, field, preset); }}>{preset}</button>)}
                        </div>}
                      </div> : <b>{message.brief?.[field] || "待确认"}</b>}
                      {message.brief?.[field] && editingField !== field && <em className={message.sources?.[field] === "ai" ? "ai" : "user"}>
                        {message.sources?.[field] === "ai" ? "AI 推荐" : "用户提供"}
                      </em>}
                      {index === latestBriefIndex && !readOnly && !pending && message.brief?.[field] && (editingField === field ? <button className="brief-edit confirm" type="button" onClick={() => { void commitBriefEdit(index, message); }} aria-label={`保存${fieldLabels[field]}`}>✓</button> : <button className="brief-edit" type="button" onClick={() => { setEditingField(field); setEditingValue(message.brief?.[field] || ""); }} aria-label={`编辑${fieldLabels[field]}`} title={`编辑${fieldLabels[field]}`}>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16.8V20h3.2L18.5 8.7l-3.2-3.2L4 16.8Zm13.8-12.3 1.7-1.7a1.5 1.5 0 0 1 2.1 0l.9.9a1.5 1.5 0 0 1 0 2.1l-1.7 1.7-3-3Z" /></svg>
                      </button>)}
                    </div>
                  ))}
                  {message.constraints?.length ? <div className="brief-constraints">约束：{message.constraints.join(" · ")}</div> : null}
                  {index === latestBriefIndex && !readOnly && <div className="brief-card-footer"><button type="button" disabled={(Object.keys(fieldLabels) as (keyof Brief)[]).some((field) => !brief[field]) || pending} onClick={() => { void generateFromBriefCard(message); }}>生成方案</button></div>}
                </section>}
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
            <img src={reference.thumbnail} alt="待参考的上传图片" />
            <button type="button" onClick={() => setReference(null)} aria-label="移除参考图">×</button>
          </div>}
          <div className="composer-row">
            <input ref={fileInputRef} className="file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { void selectReference(event.target.files?.[0]); event.currentTarget.value = ""; }} />
            <button className="upload" type="button" disabled={pending || readOnly} onClick={() => fileInputRef.current?.click()} aria-label="上传参考图" title="上传参考图">＋</button>
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
              placeholder={readOnly ? "此对话仅可查看" : mode === "review" ? "告诉我你想修改什么…" : "输入主标题、副标题、文案、尺寸和风格…"}
              rows={1}
              maxLength={2000}
              disabled={pending || readOnly}
            />
            <button className="send" type="submit" disabled={pending || readOnly || !input.trim()}>发送</button>
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
