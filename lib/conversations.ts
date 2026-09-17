import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type ConversationImage = { url: string };
export type ConversationBrief = {
  title: string;
  subtitle: string;
  copy: string;
  size: string;
  style: string;
};
export type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
  images?: ConversationImage[];
  referenceThumbnail?: string;
  brief?: ConversationBrief;
  sources?: Partial<Record<keyof ConversationBrief, "user" | "ai">>;
  constraints?: string[];
};
type StoredConversation = {
  id: string;
  token: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ConversationMessage[];
};
export type ConversationSummary = Pick<StoredConversation, "id" | "title" | "createdAt" | "updatedAt"> & {
  messageCount: number;
};
export type PublicConversation = Omit<StoredConversation, "token">;

const filePath = process.env.CONVERSATION_STORE_PATH || join(process.cwd(), "data", "conversations.json");
let writeQueue: Promise<void> = Promise.resolve();

function publicConversation(conversation: StoredConversation): PublicConversation {
  const { token: _token, ...value } = conversation;
  return value;
}

function cleanText(value: unknown, max = 4_000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanMessage(value: unknown): ConversationMessage | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  if (source.role !== "user" && source.role !== "assistant") return null;

  const content = cleanText(source.content);
  const images = Array.isArray(source.images)
    ? source.images.flatMap((image) => {
      const url = image && typeof image === "object" ? cleanText((image as Record<string, unknown>).url, 2_000) : "";
      return /^https:\/\//.test(url) ? [{ url }] : [];
    }).slice(0, 2)
    : undefined;
  const referenceThumbnail = typeof source.referenceThumbnail === "string" && /^data:image\/(?:png|jpeg|webp);base64,/.test(source.referenceThumbnail) && source.referenceThumbnail.length <= 100_000
    ? source.referenceThumbnail
    : undefined;
  const rawBrief = source.brief && typeof source.brief === "object" ? source.brief as Record<string, unknown> : undefined;
  const brief = rawBrief ? {
    title: cleanText(rawBrief.title, 1_000),
    subtitle: cleanText(rawBrief.subtitle, 1_000),
    copy: cleanText(rawBrief.copy, 1_000),
    size: cleanText(rawBrief.size, 100),
    style: cleanText(rawBrief.style, 1_000),
  } : undefined;
  const rawSources = source.sources && typeof source.sources === "object" ? source.sources as Record<string, unknown> : undefined;
  const sources = rawSources ? Object.fromEntries(
    Object.entries(rawSources).filter(([, item]) => item === "user" || item === "ai"),
  ) as ConversationMessage["sources"] : undefined;
  const constraints = Array.isArray(source.constraints)
    ? source.constraints.map((item) => cleanText(item, 200)).filter(Boolean).slice(0, 12)
    : undefined;

  if (!content && !images?.length && !referenceThumbnail && !brief) return null;
  return { role: source.role, content, images, referenceThumbnail, brief, sources, constraints };
}

async function readStore(): Promise<StoredConversation[]> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as StoredConversation[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeStore(conversations: StoredConversation[]) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(conversations), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, filePath);
}

async function mutate<T>(operation: (conversations: StoredConversation[]) => T): Promise<T> {
  let result!: T;
  const job = writeQueue.then(async () => {
    const conversations = await readStore();
    result = operation(conversations);
    await writeStore(conversations);
  });
  writeQueue = job.catch(() => undefined);
  await job;
  return result;
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const conversations = await readStore();
  return conversations
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(({ id, title, createdAt, updatedAt, messages }) => ({
      id,
      title,
      createdAt,
      updatedAt,
      messageCount: messages.length,
    }));
}

export async function createConversation(): Promise<{ conversation: PublicConversation; token: string }> {
  return mutate((conversations) => {
    const now = new Date().toISOString();
    const conversation: StoredConversation = {
      id: randomUUID(),
      token: randomUUID(),
      title: "新的设计需求",
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    conversations.push(conversation);
    return { conversation: publicConversation(conversation), token: conversation.token };
  });
}

export async function getConversation(id: string): Promise<PublicConversation | null> {
  const conversation = (await readStore()).find((item) => item.id === id);
  return conversation ? publicConversation(conversation) : null;
}

export async function appendConversationMessage(
  id: string,
  token: string | null,
  message: unknown,
): Promise<PublicConversation | null> {
  const cleaned = cleanMessage(message);
  if (!cleaned) throw new Error("消息格式不正确。");

  return mutate((conversations) => {
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation) return null;
    if (!token || token !== conversation.token) throw new Error("只读对话不能修改。");

    conversation.messages.push(cleaned);
    conversation.updatedAt = new Date().toISOString();
    if (cleaned.role === "user" && conversation.title === "新的设计需求") {
      conversation.title = cleaned.content.slice(0, 24) || conversation.title;
    }
    return publicConversation(conversation);
  });
}

export async function replaceConversationMessage(
  id: string,
  token: string | null,
  messageIndex: number,
  message: unknown,
): Promise<PublicConversation | null> {
  const cleaned = cleanMessage(message);
  if (!cleaned || !Number.isInteger(messageIndex) || messageIndex < 0) {
    throw new Error("消息格式不正确。");
  }

  return mutate((conversations) => {
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation) return null;
    if (!token || token !== conversation.token) throw new Error("只读对话不能修改。");
    if (!conversation.messages[messageIndex]) throw new Error("要更新的需求卡片不存在。");

    conversation.messages[messageIndex] = cleaned;
    conversation.updatedAt = new Date().toISOString();
    return publicConversation(conversation);
  });
}
