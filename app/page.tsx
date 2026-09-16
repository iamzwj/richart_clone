"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type Message = { role: "user" | "assistant"; content: string };

const welcome: Message = {
  role: "assistant",
  content: "你好，我是阿Jay的数字分身。你可以问我关于 AI 自动化、设计、网站或产品开发的事。",
};

const starters = ["你最近在做什么？", "聊聊 AI 自动化", "怎样开始一个网站项目？"];

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([welcome]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const name = process.env.NEXT_PUBLIC_CLONE_NAME || "Richart J";
  const tagline = process.env.NEXT_PUBLIC_CLONE_TAGLINE || "视觉设计师 · AI 自动化 · 数字产品";

  useEffect(() => {
    const report = (message: string) => {
      void fetch("/api/client-error", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: message.slice(0, 500) }),
      }).catch(() => undefined);
    };

    const onError = (event: ErrorEvent) => {
      const error = event.error;
      report(error instanceof Error ? `${error.name}: ${error.message}` : event.message);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      report(reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason));
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  useEffect(() => {
    const element = endRef.current;
    if (!element || typeof element.scrollIntoView !== "function") return;

    try {
      element.scrollIntoView({ behavior: "smooth", block: "end" });
    } catch {
      // Some embedded browsers reject the options object.
      try {
        element.scrollIntoView();
      } catch {
        // Scrolling is cosmetic; it must never break chat rendering.
      }
    }
  }, [messages, pending]);

  async function send(event?: FormEvent, preset?: string) {
    event?.preventDefault();
    const content = (preset ?? input).trim();
    if (!content || pending) return;

    const nextMessages = [...messages, { role: "user" as const, content }];
    setMessages(nextMessages);
    setInput("");
    setPending(true);

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
        for (const event of events) {
          if (!event.startsWith("data: ")) continue;
          const data = JSON.parse(event.slice(6)) as { delta?: string; error?: string };
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
    } catch {
      setMessages((current) => [...current, { role: "assistant", content: "网络连接出了点问题，请稍后再试。" }]);
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="shell">
      <section className="intro">
        <div className="eyebrow">DIGITAL COUNTERPART</div>
        <h1>{name}<span>.</span></h1>
        <p>{tagline}</p>
        <div className="portrait" aria-hidden="true"><i /></div>
        <small>不是本人，但会基于公开设定诚实回答。</small>
      </section>
      <section className="chat" aria-label="与数字分身对话">
        <header><div className="status"><b /> 在线</div><p>和 {name} 聊聊</p></header>
        <div className="messages">
          {messages.map((message, index) => <div className={`message ${message.role}`} key={`${message.role}-${index}`}>{message.content}</div>)}
          {pending && <div className="message assistant typing"><i /><i /><i /></div>}
          <div ref={endRef} />
        </div>
        {messages.length === 1 && <div className="starters">{starters.map((starter) => <button key={starter} onClick={() => send(undefined, starter)}>{starter}</button>)}</div>}
        <form onSubmit={send} className="composer">
          <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="输入你的问题…" rows={1} maxLength={2000} disabled={pending} />
          <button type="submit" disabled={pending || !input.trim()} aria-label="发送消息">↑</button>
        </form>
      </section>
    </main>
  );
}
