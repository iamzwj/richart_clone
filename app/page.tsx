"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type Message = { role: "user" | "assistant"; content: string };

const welcome: Message = {
  role: "assistant",
  content: "你好，我是张文杰设计助理。你有什么设计需求可以先跟我说，我可以尝试帮你设计。",
};

const starters = [
  { title: "梳理设计需求", label: "从模糊想法，到清晰 brief", prompt: "请帮我梳理一个设计需求。先问我最关键的三个问题，了解目标、受众和交付物，再整理成设计 brief。" },
  { title: "评审设计方案", label: "找到问题，给出修改优先级", prompt: "我想评审一个设计方案。我会用文字描述方案，请先引导我补充设计目标、使用场景和现有方案，再从信息层级、视觉一致性和可用性给出建议。" },
  { title: "探索视觉方向", label: "概念、配色、字体与构图", prompt: "请帮我探索三个有差异的视觉方向。先了解项目和受众，再给出每个方向的概念、配色、字体气质、构图建议和适用场景。" },
  { title: "编写 AI 创作提示词", label: "让视觉想法变得可描述", prompt: "请帮我写一组 AI 图像创作提示词。先问我主体、用途、画幅和期望风格，再输出可复制的提示词与迭代建议。" },
];

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([welcome]);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const name = process.env.NEXT_PUBLIC_CLONE_NAME || "张文杰";
  const tagline = process.env.NEXT_PUBLIC_CLONE_TAGLINE || "视觉设计 · AI 设计 · 海报与详情页";

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
    } catch (error) {
      setError(error instanceof Error ? error.message : "暂时无法连接，请稍后重试。");
      setInput(content);
      setMessages((current) => current.filter((message) => message.content.trim()));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="shell">
      <section className="intro">
        <div className="eyebrow">DESIGN COUNTERPART</div>
        <h1>{name}<span>.</span></h1>
        <p>{tagline}</p>
        <div className="portrait" aria-hidden="true"><i /></div>
        <div className="intro-description">把我的设计思考，<br />变成随时在场的灵感搭档。</div><div className="expertise"><span>视觉设计</span><span>AI 创作</span><span>AI 工具</span></div><small>AI 分身 · 基于个人资料回答，不代表本人承诺</small>
      </section>
      <section className="chat" aria-label="与张文杰设计助理对话">
        <header><div className="status"><b /> 设计工作台</div><button className="reset" disabled={pending} onClick={() => { setMessages([welcome]); setError(""); setInput(""); }}>新对话 ＋</button></header>
        <div className="messages" role="log" aria-label="对话记录" aria-live="polite">
          {messages.map((message, index) => <div className={`message ${message.role}`} key={`${message.role}-${index}`}>{message.content}</div>)}
          {pending && <div className="message assistant typing"><i /><i /><i /></div>}
          <div ref={endRef} />
        </div>
        {messages.length === 1 && <div className="starters">{starters.map((starter) => <button key={starter.title} onClick={() => { setInput(starter.prompt); }}><strong>{starter.title}<span>↗</span></strong><small>{starter.label}</small></button>)}</div>}
        <div className="composer-area">{error && <p className="error" role="alert">{error}</p>}<form onSubmit={send} className="composer">
          <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} aria-label="设计问题" placeholder="描述你的项目，或从一个设计问题开始…" rows={1} maxLength={2000} disabled={pending} />
          <button type="submit" disabled={pending || !input.trim()} aria-label="发送消息">↑</button>
        </form><p className="composer-note">Enter 发送 · Shift + Enter 换行 · 当前支持文字对话</p></div>
      </section>
    </main>
  );
}
