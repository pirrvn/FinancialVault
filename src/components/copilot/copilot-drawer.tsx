"use client";

import * as React from "react";
import { ArrowUp, Sparkles, Square, RotateCcw, LoaderCircle } from "lucide-react";
import { Sheet } from "../ui/sheet";
import { Kbd } from "../ui/input";
import { Markdown } from "./markdown";
import { useCopilot } from "./copilot-provider";
import { cn } from "@/lib/utils";

interface Message {
  role: "user" | "assistant";
  content: string;
  tools?: string[];
  error?: string;
}

const SUGGESTIONS = [
  "How much did I spend on dining out across both banks this month?",
  "What are my biggest expense categories over the last 3 months?",
  "Which subscriptions could I cancel, and how much would I save per year?",
  "If I cut variable spending by 15%, where will my balance be in 12 months?",
];

export function CopilotDrawer() {
  const { open, setOpen, pending, consumePending } = useCopilot();
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = React.useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || busy) return;
      const history = [...messages.filter((m) => !m.error && m.content), { role: "user" as const, content: question }];
      setMessages((prev) => [...prev, { role: "user", content: question }, { role: "assistant", content: "", tools: [] }]);
      setInput("");
      setBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;
      const patchLast = (fn: (m: Message) => Message) => setMessages((prev) => [...prev.slice(0, -1), fn(prev[prev.length - 1])]);
      try {
        const res = await fetch("/api/copilot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })) }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? "Request failed");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line);
            if (event.type === "text") patchLast((m) => ({ ...m, content: m.content + event.text }));
            else if (event.type === "tool") patchLast((m) => ({ ...m, tools: [...(m.tools ?? []), event.label] }));
            else if (event.type === "error") patchLast((m) => ({ ...m, error: event.message }));
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") patchLast((m) => ({ ...m, error: (err as Error).message }));
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, messages],
  );

  React.useEffect(() => {
    if (open && pending) {
      const q = consumePending();
      if (q) void send(q);
    }
  }, [open, pending, consumePending, send]);

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      width="sm:max-w-[440px]"
      title={
        <span className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-lg bg-gradient-to-br from-[#7A86C2] to-[#4E9E9C] text-white">
            <Sparkles className="size-3.5" />
          </span>
          Copilot
        </span>
      }
      description="Ask anything about your money, across every bank."
    >
      <div ref={scrollRef} className="flex-1 scrollbar-thin overflow-y-auto px-6 pb-4">
        {messages.length === 0 ? (
          <div className="animate-rise space-y-2 pt-6">
            <p className="mb-3 text-xs font-medium tracking-wide text-subtle uppercase">Try asking</p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="block w-full rounded-2xl bg-fill px-4 py-3 text-left text-[13.5px] transition-colors hover:bg-fill-strong"
              >
                {s}
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-5 pt-2">
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] rounded-[20px] rounded-br-md bg-accent px-4 py-2 text-[14px] leading-relaxed text-accent-fg">{m.content}</div>
                </div>
              ) : (
                <div key={i} className="animate-fade-in">
                  {!!m.tools?.length && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {m.tools.map((t, j) => (
                        <span key={j} className="inline-flex items-center gap-1 rounded-full bg-fill px-2 py-0.5 text-[11px] text-muted">
                          <Sparkles className="size-3" /> {t}
                        </span>
                      ))}
                    </div>
                  )}
                  {m.content ? <Markdown text={m.content} /> : busy && i === messages.length - 1 && !m.error && <Thinking />}
                  {m.error && <p className="mt-1 text-[13px] text-negative">{m.error}</p>}
                </div>
              ),
            )}
          </div>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="px-4 pb-4"
      >
        <div className="flex items-end gap-2 rounded-3xl bg-surface p-1.5 pl-4 shadow-card">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={1}
            placeholder="Ask about your spending…"
            className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent py-2 text-[14px] outline-none placeholder:text-subtle"
            autoFocus
          />
          {busy ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="flex size-8 items-center justify-center rounded-full bg-fg text-bg"
              aria-label="Stop"
            >
              <Square className="size-3 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="flex size-8 items-center justify-center rounded-full bg-accent text-accent-fg transition-opacity disabled:opacity-30"
              aria-label="Send"
            >
              <ArrowUp className="size-4" strokeWidth={2.5} />
            </button>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between px-2 text-[11px] text-subtle">
          <span>
            <Kbd>⌘</Kbd> <Kbd>J</Kbd> to toggle
          </span>
          {messages.length > 0 && !busy && (
            <button type="button" onClick={() => setMessages([])} className={cn("inline-flex items-center gap-1 hover:text-fg")}>
              <RotateCcw className="size-3" /> New chat
            </button>
          )}
        </div>
      </form>
    </Sheet>
  );
}

function Thinking() {
  return (
    <span className="inline-flex items-center gap-2 text-[13px] text-muted">
      <LoaderCircle className="size-3.5 animate-spin" /> Thinking…
    </span>
  );
}
