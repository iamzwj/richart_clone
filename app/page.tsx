"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type Message = { role: "user" | "assistant"; content: string };

const welcome: Message = {
  role: "assistant",
  content: "你好，我是张文杰设计助理。你有什么设计需求可以先跟我说，我可以尝试帮你设计。",
};

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([welcome]);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const name = process.env.NEXT_PUBLIC_CLONE_NAME || "张文杰";
  const isReplyStarted = messages.at(-1)?.role === "assistant";

  useEffect(() => {
    const element = endRef.current;
    if (!element || typeof element.scrollIntoView !== "function") return;

    try {
      element.scrollIntoView({ behavior: "smooth", block: "end" });
    } catch {
      element.scrollIntoView();
    }
  }, [messages, pending, error]);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const content = input.trim();
    if (!content || pending) return;

    const nextMessages = [...messages, { role: "user" as const, content }];
    setMessages(nextMessages);
    setInput("");
    setPending(true);
    setError("");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });
      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "暂时无法连接到聊天服务。");
      }

      setMessages((current) => [...current, { role: "assistant", content: "" }]);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });

        const events = buffer.split("\n\n");
        buffer = events.pop() || "";
        for (const streamEvent of events) {
          if (!streamEvent.startsWith("data: ")) continue;
          const data = JSON.parse(streamEvent.slice(6)) as { delta?: string; error?: string };
          if (data.error) throw new Error(data.error);
          if (data.delta) {
            setMessages((current) => current.map((message, index) => (
              index === current.length - 1 && message.role === "assistant"
                ? { ...message, content: `${message.content}${data.delta}` }
                : message
            )));
          }
        }

        if (done) break;
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "暂时无法连接，请稍后重试。");
      setInput(content);
      setMessages((current) => current.filter((message) => message.content.trim()));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="wechat-page">
      <section className="wechat-window" aria-label="与张文杰设计助理对话">
        <header className="chat-header">
          <div className="header-spacer" aria-hidden="true" />
          <div className="contact">
            <h1>{name}设计助理</h1>
            <p aria-live="polite">{pending ? "对方正在输入…" : "在线"}</p>
          </div>
          <button
            className="new-chat"
            type="button"
            disabled={pending}
            onClick={() => { setMessages([welcome]); setError(""); setInput(""); }}
            aria-label="新对话"
            title="新对话"
          >
            ↻
          </button>
        </header>

        <div className="conversation" role="log" aria-label="对话记录" aria-live="polite">
          {messages.map((message, index) => message.content && (
            <article className={`chat-row ${message.role}`} key={`${message.role}-${index}`}>
              <div className="avatar" aria-hidden="true">
                {message.role === "assistant" ? <img src="/zhangwenjie-avatar.png" alt="" /> : "我"}
              </div>
              <div className="bubble">{message.content}</div>
            </article>
          ))}
          {pending && !isReplyStarted && (
            <article className="chat-row assistant" aria-label="对方正在输入">
              <div className="avatar" aria-hidden="true"><img src="/zhangwenjie-avatar.png" alt="" /></div>
              <div className="bubble typing"><i /><i /><i /></div>
            </article>
          )}
          {error && <p className="error" role="alert">{error}</p>}
          <div ref={endRef} />
        </div>

        <form onSubmit={send} className="composer">
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
            placeholder="输入你的设计需求…"
            rows={1}
            maxLength={2000}
            disabled={pending}
          />
          <button type="submit" disabled={pending || !input.trim()}>发送</button>
        </form>
      </section>
    </main>
  );
}
