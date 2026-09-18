"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { DEFAULT_DESIGN_SIZE, DESIGN_SIZE_OPTIONS } from "@/lib/design-sizes";

type Brief = {
  title: string;
  subtitle: string;
  copy: string;
  supplement: string;
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
  designPrompt?: string;
};
type ReferenceImage = { dataUrl: string; thumbnail: string; name: string };
type ConversationSummary = { id: string; title: string; createdAt: string; updatedAt: string; messageCount: number };
type ActiveConversation = { id: string; token: string };

const emptyBrief: Brief = { title: "", subtitle: "", copy: "", supplement: "", size: DEFAULT_DESIGN_SIZE, style: "" };
const welcome: Message = {
  role: "assistant",
  content: "你好，我是张文杰设计助理。你有什么设计需求可以先跟我说，我可以尝试帮你设计。\n\n你可以跟我说你要做什么，例如：设计一个海报，主标题是xxx，副标题是xxx，下面的文案是xxx，尺寸是：9:16，3d卡通风格。",
};
const fieldLabels: Record<keyof Brief, string> = {
  title: "主标题",
  subtitle: "副标题",
  copy: "文案",
  size: "比例",
  style: "风格",
  supplement: "补充说明",
};
const requiredBriefFields: (keyof Brief)[] = ["title", "size", "style"];

function missingRequiredBriefFields(brief: Brief): (keyof Brief)[] {
  return requiredBriefFields.filter((field) => !brief[field]);
}
const fieldPlaceholders: Record<keyof Brief, string> = {
  title: "填写海报最重要的一句话",
  subtitle: "（选填）填写对主标题的补充说明",
  copy: "（选填）填写需要展示的正文内容",
  supplement: "（选填）填写画面元素、排版或禁用项",
  size: "选择尺寸",
  style: "填写或选择画面风格",
};
const stylePresets = ["3D 卡通", "写实风", "极简平面", "国潮插画", "轻奢质感"];
const activeConversationKey = "zhangwenjie-design-active-conversation";
const ownedConversationKey = "zhangwenjie-design-owned-conversations";
const legacyConversationKey = "zhangwenjie-design-conversation";

function ownedConversationTokens(): Record<string, string> {
  try {
    const value = JSON.parse(window.localStorage.getItem(ownedConversationKey) || "{}") as unknown;
    if (!value || typeof value !== "object") return {};
    return Object.fromEntries(Object.entries(value).filter(([id, token]) => typeof id === "string" && typeof token === "string" && token.length > 0));
  } catch {
    return {};
  }
}

function rememberConversation(active: ActiveConversation) {
  const owned = ownedConversationTokens();
  owned[active.id] = active.token;
  window.localStorage.setItem(ownedConversationKey, JSON.stringify(owned));
  window.localStorage.setItem(activeConversationKey, active.id);
}

function forgetConversation(id: string) {
  const owned = ownedConversationTokens();
  delete owned[id];
  window.localStorage.setItem(ownedConversationKey, JSON.stringify(owned));
  if (window.localStorage.getItem(activeConversationKey) === id) {
    window.localStorage.removeItem(activeConversationKey);
  }
}

function ownedConversationToken(id: string): string | null {
  return ownedConversationTokens()[id] || null;
}

function migrateLegacyConversation(): ActiveConversation | null {
  try {
    const saved = window.sessionStorage.getItem(legacyConversationKey);
    if (!saved) return null;
    const active = JSON.parse(saved) as ActiveConversation;
    if (!active.id || !active.token) return null;
    rememberConversation(active);
    return active;
  } catch {
    return null;
  } finally {
    window.sessionStorage.removeItem(legacyConversationKey);
  }
}

function displayImageUrl(url: string): string {
  return url.startsWith("data:image/") || url.startsWith("/api/design/image") ? url : `/api/design/download?inline=1&url=${encodeURIComponent(url)}`;
}

function downloadImageUrl(url: string): string {
  if (url.startsWith("/api/design/image")) {
    const id = new URL(url, window.location.origin).searchParams.get("id");
    return id ? `/api/design/download?id=${encodeURIComponent(id)}` : url;
  }
  return `/api/design/download?url=${encodeURIComponent(url)}`;
}

function isSatisfied(message: string): boolean {
  return /^(ok|好的|可以|满意|就这样|没问题)[！!。.]?$/i.test(message.trim());
}
function isDesignIntent(message: string): boolean {
  return /(海报|设计|方案|图片|图像|改图|修改|调整|换成|生成|主标题|副标题|文案|尺寸|风格|配色|背景|人物|补全|二维码|logo|画面)/i.test(message);
}
function isContinuationIntent(message: string): boolean {
  return /^(?:继续|继续生成|继续做|再来|再来一版|换一版|再生成|再做一版)[！!。.]?$/i.test(message.trim());
}
function isGenerationProgress(message: Message): boolean {
  return message.role === "assistant" && /(我来帮你做|我来帮你改)/.test(message.content);
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

function applySizeDefault(messages: Message[]): Message[] {
  return messages.map((message) => message.brief && !message.brief.size ? {
    ...message,
    brief: { ...message.brief, size: DEFAULT_DESIGN_SIZE },
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
  const [editingPromptIndex, setEditingPromptIndex] = useState<number | null>(null);
  const [editingPromptValue, setEditingPromptValue] = useState("");
  const [briefDrafts, setBriefDrafts] = useState<Partial<Brief>>({});
  const [draggingReference, setDraggingReference] = useState(false);
  const [activity, setActivity] = useState<"reply" | "design" | null>(null);
  const [focusComposerRequest, setFocusComposerRequest] = useState(0);
  const [ratioPickerOpen, setRatioPickerOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
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

  useEffect(() => {
    if (!focusComposerRequest || readOnly || pending || loadingConversation) return;
    const frame = window.requestAnimationFrame(() => composerInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [focusComposerRequest, loadingConversation, pending, readOnly]);

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
      if (response.status === 404) {
        forgetConversation(id);
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
        setError("");
        setRatioPickerOpen(false);
        void refreshConversationList();
        return;
      }
      if (!response.ok || !data.conversation) throw new Error("无法读取对话记录。");
      setConversationId(id);
      setWriteToken(token);
      setReadOnly(!token);
      if (token) rememberConversation({ id, token });
      const loadedMessages = applySizeDefault(data.conversation.messages?.length ? data.conversation.messages : [welcome]);
      const latestBrief = [...loadedMessages].reverse().find((message) => message.brief);
      const latestImages = [...loadedMessages].reverse().find((message) => message.images?.length)?.images || [];
      setMessages(loadedMessages);
      setBrief(latestBrief?.brief || emptyBrief);
      setSources(latestBrief?.sources || {});
      setConstraints(latestBrief?.constraints || []);
      setReference(null);
      setGeneratedImages(latestImages);
      setMode("review");
      setError("");
      setRatioPickerOpen(false);
      if (token) setFocusComposerRequest((current) => current + 1);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "无法读取对话记录。");
    } finally {
      setLoadingConversation(false);
    }
  }

  useEffect(() => {
    void refreshConversationList();
    const timer = window.setInterval(() => { void refreshConversationList(); }, 3_000);
    const legacyActive = migrateLegacyConversation();
    const activeId = legacyActive?.id || window.localStorage.getItem(activeConversationKey);
    const token = legacyActive?.token || (activeId ? ownedConversationToken(activeId) : null);
    if (activeId && token) void openConversation(activeId, token);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!conversationId || !readOnly) return;
    const timer = window.setInterval(() => { void openConversation(conversationId, null); }, 3_000);
    return () => window.clearInterval(timer);
  }, [conversationId, readOnly]);

  useEffect(() => {
    const clearDraggingReference = () => setDraggingReference(false);
    window.addEventListener("dragend", clearDraggingReference);
    window.addEventListener("drop", clearDraggingReference);
    return () => {
      window.removeEventListener("dragend", clearDraggingReference);
      window.removeEventListener("drop", clearDraggingReference);
    };
  }, []);

  async function ensureConversation(): Promise<ActiveConversation> {
    if (conversationId && writeToken) return { id: conversationId, token: writeToken };
    const response = await fetch("/api/conversations", { method: "POST" });
    const data = await response.json().catch(() => ({})) as { conversation?: { id: string }; token?: string; error?: string };
    if (!response.ok || !data.conversation?.id || !data.token) throw new Error(data.error || "无法创建对话。");
    const active = { id: data.conversation.id, token: data.token };
    rememberConversation(active);
    setConversationId(active.id);
    setWriteToken(active.token);
    setReadOnly(false);
    void refreshConversationList();
    return active;
  }

  async function saveMessage(active: ActiveConversation, message: Message) {
    const job = saveQueueRef.current.then(async () => {
      const response = await fetch(`/api/conversations/${active.id}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-conversation-token": active.token },
        body: JSON.stringify({ message }),
      });
      if (!response.ok) throw new Error("对话保存失败，请重试。");
      void refreshConversationList();
    });
    saveQueueRef.current = job.catch(() => undefined);
    return job;
  }

  async function saveUpdatedMessage(active: ActiveConversation, messageIndex: number, message: Message) {
    await saveQueueRef.current;
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
    if (field === "size") setRatioPickerOpen(false);
    if (!conversationId || !writeToken) return;
    const storedMessageIndex = messages[0] === welcome ? messageIndex - 1 : messageIndex;
    if (storedMessageIndex < 0) return;
    try {
      await saveUpdatedMessage({ id: conversationId, token: writeToken }, storedMessageIndex, updatedMessage);
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

  async function persistDesignPrompt(messageIndex: number, message: Message, rawValue: string): Promise<Message | null> {
    const designPrompt = rawValue.trim();
    if (!designPrompt) return null;
    const updatedMessage = { ...message, designPrompt };
    setMessages((current) => current.map((item, index) => index === messageIndex ? updatedMessage : item));
    if (!conversationId || !writeToken) return updatedMessage;
    const storedMessageIndex = messages[0] === welcome ? messageIndex - 1 : messageIndex;
    if (storedMessageIndex < 0) return updatedMessage;
    try {
      await saveUpdatedMessage({ id: conversationId, token: writeToken }, storedMessageIndex, updatedMessage);
      return updatedMessage;
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "提示词保存失败，请重试。");
      return null;
    }
  }

  async function generateFromEditedPrompt(messageIndex: number, message: Message) {
    const updatedMessage = await persistDesignPrompt(messageIndex, message, editingPromptValue);
    setEditingPromptIndex(null);
    setEditingPromptValue("");
    if (!updatedMessage?.designPrompt || pending) return;
    try {
      const active = await ensureConversation();
      const nextBrief = updatedMessage.brief || brief;
      await generate(
        nextBrief,
        active,
        undefined,
        { brief: nextBrief, sources: updatedMessage.sources || sources, constraints: updatedMessage.constraints || constraints },
        undefined,
        nextBrief.title,
        updatedMessage.designPrompt,
      );
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "暂时无法开始设计，请稍后重试。");
    }
  }

  async function generateFromBriefCard(message: Message) {
    const missing = missingRequiredBriefFields(brief);
    if (missing.length) {
      setError("请先填写所有必要信息。");
      return;
    }
    try {
      const active = await ensureConversation();
      await generate(brief, active, undefined, { brief, sources, constraints: message.constraints || constraints }, undefined, brief.title);
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

  async function answerGeneralQuestion(message: string): Promise<string> {
    const response = await fetch("/api/assistant/reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const data = await response.json().catch(() => ({})) as { reply?: string; error?: string };
    if (!response.ok || !data.reply) throw new Error(data.error || "暂时无法回答，请稍后重试。");
    return data.reply;
  }

  async function createImages(
    nextBrief: Brief,
    references: string[],
    modification?: string,
    count = 2,
    activeConstraints = constraints,
    filenamePrompt?: string,
    prompt?: string,
  ): Promise<GeneratedImage[]> {
    const response = await fetch("/api/design/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brief: nextBrief, references, modification, constraints: activeConstraints, count, filenamePrompt, prompt }),
    });
    const data = await response.json().catch(() => ({})) as { images?: GeneratedImage[]; error?: string };
    if (!response.ok || !data.images?.length) {
      throw new Error(data.error || "生图失败，请稍后重试。");
    }
    return data.images;
  }

  async function createDesignPrompt(
    nextBrief: Brief,
    activeConstraints: string[],
    modification: string | undefined,
    hasReference: boolean,
  ): Promise<string> {
    const response = await fetch("/api/design/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brief: nextBrief, constraints: activeConstraints, modification, hasReference }),
    });
    const data = await response.json().catch(() => ({})) as { prompt?: string; error?: string };
    if (!response.ok || !data.prompt) throw new Error(data.error || "暂时无法生成设计提示词，请稍后重试。");
    return data.prompt;
  }

  async function generate(
    nextBrief: Brief,
    active: ActiveConversation,
    modification?: string,
    snapshot?: Pick<Message, "brief" | "sources" | "constraints">,
    directReferences?: string[],
    filenamePrompt?: string,
    promptOverride?: string,
  ) {
    setPending(true);
    setActivity("design");
    setError("");
    const progressMessage: Message = {
      role: "assistant",
      content: modification ? "收到，我来帮你改…" : "收到，我来帮你做…",
      ...snapshot,
    };
    setMessages((current) => [...current, progressMessage]);
    void saveMessage(active, progressMessage);

    try {
      const activeConstraints = snapshot?.constraints || constraints;
      const sources = directReferences || (reference
        ? [reference.dataUrl]
        : generatedImages.map((image) => image.url).slice(0, 2));
      const designPrompt = promptOverride || await createDesignPrompt(nextBrief, activeConstraints, modification, sources.length > 0);
      const promptMessage = { ...progressMessage, designPrompt };
      setMessages((current) => current.map((message, index) => index === current.length - 1 ? promptMessage : message));
      const storedPromptIndex = messages[0] === welcome ? messages.length - 1 : messages.length;
      void saveUpdatedMessage(active, storedPromptIndex, promptMessage).catch((promptError) => {
        setError(promptError instanceof Error ? promptError.message : "提示词保存失败，请重试。");
      });

      const images = modification && sources.length > 1
        ? (await Promise.all(sources.map((source) => createImages(nextBrief, [source], modification, 1, activeConstraints, filenamePrompt, designPrompt)))).flat()
        : await createImages(nextBrief, sources, modification, 2, activeConstraints, filenamePrompt, designPrompt);

      const result = images.slice(0, 2);
      setGeneratedImages(result);
      setReference(null);
      setMode("review");
      const resultMessage: Message = {
        role: "assistant",
        content: "",
        images: result,
      };
      setMessages((current) => [...current, resultMessage]);
      void saveMessage(active, resultMessage);
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "生图失败，请稍后重试。");
    } finally {
      setPending(false);
      setActivity(null);
    }
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const content = input.trim();
    if (!content || pending || readOnly) return;

    setPending(true);
    setActivity("reply");
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
        await generate(editBrief, active, content, undefined, [selectedReference.dataUrl], content);
        return;
      }

      if (isContinuationIntent(content) && !missingRequiredBriefFields(brief).length) {
        const previousImages = generatedImages.length
          ? generatedImages
          : [...messages].reverse().find((message) => message.images?.length)?.images || [];
        setGeneratedImages(previousImages);
        setPending(false);
        await generate(
          brief,
          active,
          previousImages.length ? "保持当前方案的关键信息，继续生成一版新的设计方案。" : undefined,
          undefined,
          previousImages.map((image) => image.url),
          brief.title,
        );
        return;
      }

      if (mode === "review" && isSatisfied(content)) {
        const reply: Message = { role: "assistant", content: "太好了。如果还需要新的尺寸、文案或风格，直接告诉我修改方向就可以。" };
        setMessages((current) => [...current, reply]);
        void saveMessage(active, reply);
        return;
      }

      if (!isDesignIntent(content)) {
        const reply: Message = { role: "assistant", content: await answerGeneralQuestion(content) };
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
      const missing = missingRequiredBriefFields(nextBrief);
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
      await generate(nextBrief, active, mode === "review" ? content : undefined, mode === "collect" ? {
        brief: nextBrief,
        sources: nextSources,
        constraints: nextConstraints,
      } : undefined, undefined, content);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "暂时无法读取需求，请稍后重试。");
    } finally {
      setPending(false);
      setActivity(null);
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
    window.localStorage.removeItem(activeConversationKey);
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
    setActivity(null);
    setRatioPickerOpen(false);
    setFocusComposerRequest((current) => current + 1);
  }

  const latestBriefIndex = messages.reduce((latest, message, index) => message.brief ? index : latest, -1);

  return (
    <main
      className="workspace"
      onDragOver={(event) => {
        if (readOnly || !Array.from(event.dataTransfer.types).includes("Files")) return;
        event.preventDefault();
        setDraggingReference(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDraggingReference(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDraggingReference(false);
        if (!readOnly) void selectReference(event.dataTransfer.files?.[0]);
      }}
    >
      <aside className="conversation-sidebar" aria-label="公开对话列表">
        <div className="sidebar-header">
          <div className="sidebar-title">
            <img src="/zhangwenjie-avatar.png" alt="" />
            <div><h2>对话记录</h2><p>所有访客可查看</p></div>
          </div>
          <button className="new-conversation" type="button" onClick={resetConversation} disabled={pending}>新对话</button>
        </div>
        <div className="sidebar-list">
          {!conversationList.length ? <p className="empty-list">暂时还没有公开对话。</p> : conversationList.map((conversation) => (
            <button
              type="button"
              className={`conversation-item ${conversation.id === conversationId ? "active" : ""}`}
              key={conversation.id}
              onClick={() => {
                void openConversation(conversation.id, ownedConversationToken(conversation.id));
              }}
            >
              <strong>{conversation.title}</strong>
            </button>
          ))}
        </div>
      </aside>
      <section className="wechat-window" aria-label={`与${assistantName}对话`}>
        <header className="chat-header">
          <div className="contact">
            <h1 aria-live="polite">{pending ? <><span>{activity === "design" ? "对方正在帮你设计" : "对方正在输入"}</span><span className="status-ellipsis" aria-hidden="true"><i>·</i><i>·</i><i>·</i></span></> : assistantName}</h1>
          </div>
        </header>

        <div className="conversation" role="log" aria-label="对话记录" aria-live="polite">
          {messages.map((message, index) => (
            <article className={`chat-row ${message.role}`} key={`${message.role}-${index}`}>
              <div className="message-content">
                {message.referenceThumbnail && <button type="button" className="message-reference" onClick={() => setPreview({ url: message.referenceThumbnail || "" })} aria-label="预览参考图"><img src={message.referenceThumbnail} alt="用户上传的参考图" /></button>}
                {message.content && (message === welcome ? <WelcomeMessage /> : <div className="bubble">{message.content}</div>)}
                {message.brief && !isGenerationProgress(message) && <section className="brief-card" aria-label="当前设计需求">
                  <div className="brief-card-title">当前设计需求</div>
                  {(Object.keys(fieldLabels) as (keyof Brief)[]).map((field) => (
                    <div className={`brief-field ${field === "style" ? "style-field" : ""} ${field === "size" && index === latestBriefIndex && !readOnly ? "ratio-picker" : (!message.brief?.[field] || editingField === field) && index === latestBriefIndex ? "brief-field-input" : ""}`} key={field}>
                      <span>{fieldLabels[field]}</span>
                      {field === "size" && index === latestBriefIndex && !readOnly ? <div className="ratio-picker-control">
                        <button
                          type="button"
                          className="ratio-trigger"
                          aria-expanded={ratioPickerOpen}
                          aria-controls="ratio-options"
                          onClick={() => setRatioPickerOpen((current) => !current)}
                          disabled={pending}
                        >
                          <span><i className="ratio-icon" style={{ aspectRatio: (message.brief?.size || DEFAULT_DESIGN_SIZE).replace(":", " / ") }} aria-hidden="true" /><b>{message.brief?.size || DEFAULT_DESIGN_SIZE}</b></span>
                          <svg className={ratioPickerOpen ? "ratio-chevron open" : "ratio-chevron"} viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
                        </button>
                        {ratioPickerOpen && <div className="ratio-grid" id="ratio-options" role="radiogroup" aria-label="选择比例">
                          {DESIGN_SIZE_OPTIONS.map((option) => {
                            const selected = (message.brief?.size || DEFAULT_DESIGN_SIZE) === option.value;
                            return <button
                              type="button"
                              className={`ratio-option ${selected ? "selected" : ""}`}
                              key={option.value}
                              role="radio"
                              aria-checked={selected}
                              disabled={pending}
                              onClick={() => { void persistBriefField(index, message, field, option.value); }}
                            >
                              <i className="ratio-icon" style={{ aspectRatio: option.value.replace(":", " / ") }} aria-hidden="true" />
                              <b>{option.value}</b>
                            </button>;
                          })}
                        </div>}
                      </div> : editingField === field && index === latestBriefIndex ? field === "style" ? <div className="brief-entry">
                        <input
                          autoFocus
                          value={editingValue}
                          onChange={(event) => setEditingValue(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void commitBriefEdit(index, message);
                            if (event.key === "Escape") { setEditingField(null); setEditingValue(""); }
                          }}
                          aria-label={`编辑${fieldLabels[field]}`}
                        />
                        <div className="style-presets" aria-label="风格预设">
                          {stylePresets.map((preset) => <button type="button" key={preset} className={editingValue === preset ? "selected" : ""} onMouseDown={(event) => event.preventDefault()} onClick={() => setEditingValue(preset)}>{preset}</button>)}
                        </div>
                      </div> : <input
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
                      </div> : field === "style" ? <div className="style-summary">
                        <b>{message.brief?.[field] || "待确认"}</b>
                        <div className="style-presets" aria-label="已选风格与预设">
                          {stylePresets.map((preset) => <span key={preset} className={message.brief?.[field] === preset ? "selected" : ""}>{preset}</span>)}
                        </div>
                      </div> : <b>{message.brief?.[field] || "待确认"}</b>}
                      {field !== "size" && index === latestBriefIndex && !readOnly && !pending && message.brief?.[field] && (editingField === field ? <button className="brief-edit confirm" type="button" onClick={() => { void commitBriefEdit(index, message); }} aria-label={`保存${fieldLabels[field]}`}>✓</button> : <button className="brief-edit" type="button" onClick={() => { setEditingField(field); setEditingValue(message.brief?.[field] || ""); }} aria-label={`编辑${fieldLabels[field]}`} title={`编辑${fieldLabels[field]}`}>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16.8V20h3.2L18.5 8.7l-3.2-3.2L4 16.8Zm13.8-12.3 1.7-1.7a1.5 1.5 0 0 1 2.1 0l.9.9a1.5 1.5 0 0 1 0 2.1l-1.7 1.7-3-3Z" /></svg>
                      </button>)}
                    </div>
                  ))}
                  {message.constraints?.length ? <div className="brief-constraints">约束：{message.constraints.join(" · ")}</div> : null}
                  {index === latestBriefIndex && !readOnly && <div className="brief-card-footer"><button type="button" disabled={missingRequiredBriefFields(brief).length > 0 || pending} onClick={() => { void generateFromBriefCard(message); }}>生成方案</button></div>}
                </section>}
                {message.designPrompt && <section className="design-prompt-card" aria-label="生图提示词">
                  <div className="design-prompt-header">
                    <span>生图提示词</span>
                    {!readOnly && editingPromptIndex !== index && <button className="prompt-edit" type="button" onClick={() => { setEditingPromptIndex(index); setEditingPromptValue(message.designPrompt || ""); }} aria-label="编辑生图提示词" title="编辑生图提示词">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16.8V20h3.2L18.5 8.7l-3.2-3.2L4 16.8Zm13.8-12.3 1.7-1.7a1.5 1.5 0 0 1 2.1 0l.9.9a1.5 1.5 0 0 1 0 2.1l-1.7 1.7-3-3Z" /></svg>
                    </button>}
                  </div>
                  {editingPromptIndex === index ? <div className="design-prompt-editor" onBlur={(event) => {
                    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
                    void persistDesignPrompt(index, message, editingPromptValue);
                    setEditingPromptIndex(null);
                    setEditingPromptValue("");
                  }}>
                    <textarea autoFocus value={editingPromptValue} onChange={(event) => setEditingPromptValue(event.target.value)} aria-label="编辑生图提示词" />
                    <button type="button" disabled={pending || !editingPromptValue.trim()} onMouseDown={(event) => event.preventDefault()} onClick={() => { void generateFromEditedPrompt(index, message); }}>生成</button>
                  </div> : <pre>{message.designPrompt}</pre>}
                </section>}
                {message.images?.length ? (
                  <div className="image-gallery">
                    {message.images.map((image, imageIndex) => (
                      <figure key={image.url}>
                        <button type="button" className="image-preview" onClick={() => setPreview(image)} aria-label={`预览生成图 ${imageIndex + 1}`}>
                          <img src={displayImageUrl(image.url)} alt={`生成的设计方案 ${imageIndex + 1}`} />
                        </button>
                        <figcaption>
                          <span>方案 {imageIndex + 1}</span>
                          <a href={downloadImageUrl(image.url)}>下载</a>
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                ) : null}
              </div>
            </article>
          ))}
          {pending && activity === "design" && <article className="chat-row assistant generation-status" aria-label="我正在帮你设计">
            <div className="bubble"><span>我正在帮你设计</span><span className="status-ellipsis" aria-hidden="true"><i>·</i><i>·</i><i>·</i></span></div>
          </article>}
          {error && <p className="error" role="alert">{error}</p>}
          <div ref={endRef} />
        </div>

        <form onSubmit={send} className={`composer ${draggingReference ? "dragging-reference" : ""}`}>
          {reference && <div className="reference-preview">
            <img src={reference.thumbnail} alt="待参考的上传图片" />
            <button type="button" onClick={() => setReference(null)} aria-label="移除参考图">×</button>
          </div>}
          <div className="composer-row">
            <input ref={fileInputRef} className="file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { void selectReference(event.target.files?.[0]); event.currentTarget.value = ""; }} />
            <button className="upload" type="button" disabled={pending || readOnly} onClick={() => fileInputRef.current?.click()} aria-label="上传参考图" title="上传参考图">＋</button>
            <textarea
              ref={composerInputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
              aria-label="设计需求"
              placeholder={readOnly ? "此对话仅可查看" : "比如：你想要做什么"}
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
          <img src={displayImageUrl(preview.url)} alt="生成的设计方案预览" />
          <a href={downloadImageUrl(preview.url)}>下载图片</a>
        </div>
      </div>}
    </main>
  );
}
