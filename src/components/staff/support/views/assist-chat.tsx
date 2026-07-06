"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import type { ChatMsg } from "../support-panel";

// Route-contextual suggestion chips; key = first path segment after /staff.
const SUGGESTIONS: Record<string, string[]> = {
  "": ["Why is a vehicle in the attention queue?", "How does a booking become a paid invoice?", "Change Saturday opening hours"],
  bookings: ["Why can't I book outside business hours?", "How do bays map to the calendar?"],
  quotes: ["How do quote reminders send?", "Convert an approved quote to a booking"],
};

export function AssistChat({
  pathname,
  role,
  brandColor,
  onBrand,
  messages,
  setMessages,
  unread,
  onEscalate,
  onOpenUnread,
}: {
  pathname: string;
  role: string;
  brandColor: string;
  onBrand: string;
  messages: ChatMsg[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMsg[]>>;
  unread: number;
  onEscalate: () => void;
  onOpenUnread: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, thinking]);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || thinking) return;
    setMessages((m) => [...m, { role: "user", body: question }]);
    setDraft("");
    setThinking(true);
    try {
      const res = await fetch("/api/support/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, path: pathname }),
      });
      const data = (await res.json()) as {
        answer?: string;
        sources?: { label: string; href: string }[];
        error?: string;
      };
      if (!res.ok || !data.answer) {
        setMessages((m) => [
          ...m,
          { role: "assistant", body: data.error ?? "Assist is unavailable right now — you can still raise a ticket." },
        ]);
      } else {
        setMessages((m) => [
          ...m,
          { role: "assistant", body: data.answer!, source: data.sources?.[0] },
        ]);
      }
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", body: "Assist is unavailable right now — you can still raise a ticket." },
      ]);
    } finally {
      setThinking(false);
    }
  }

  const segment = pathname.split("/")[2] ?? "";
  const suggestions = SUGGESTIONS[segment] ?? SUGGESTIONS[""];
  const lastIdx = messages.length - 1;

  return (
    <>
      <div ref={scrollRef} className="flex max-h-[390px] min-h-[230px] flex-1 flex-col gap-2.5 overflow-y-auto p-3.5">
        {messages.map((m, i) =>
          m.role === "assistant" ? (
            <div key={i} className="flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 grid h-[22px] w-[22px] flex-none place-items-center rounded-[7px] border border-[#22262e] bg-[#0a0c0f]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/brand/mark/aigarage-mark-on-dark.svg" alt="" className="h-[11px] w-[11px]" />
                </span>
                <div className="max-w-[84%] rounded-[10px] border border-[#22262e] bg-[#171b21] px-[11px] py-[9px] text-[13px] leading-[1.55] text-[#d6dae0]">
                  {m.body}
                  {m.source && (
                    <div className="mt-2">
                      <a
                        href={m.source.href}
                        target="_blank"
                        rel="noopener"
                        className="inline-block rounded border border-[#2a2f37] bg-[#0e1116] px-[7px] py-[3px] font-mono text-[9px] tracking-[.08em] text-[#9aa1ad] no-underline hover:text-[#e6e8eb]"
                      >
                        {m.source.label} ↗
                      </a>
                    </div>
                  )}
                </div>
              </div>
              {/* Post-answer actions under the latest assistant answer only */}
              {i === lastIdx && i > 0 && !thinking && (
                <div className="ml-[30px] flex flex-wrap gap-1.5">
                  <ThatHelped />
                  <button
                    onClick={onEscalate}
                    className="rounded-full px-3 py-1.5 text-[11.5px] font-semibold text-[#e6e8eb]"
                    style={{
                      border: `1px solid color-mix(in srgb, ${brandColor} 55%, #2a2f37)`,
                      background: `color-mix(in srgb, ${brandColor} 12%, transparent)`,
                    }}
                  >
                    Still stuck — raise a ticket →
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div
              key={i}
              className="max-w-[84%] self-end rounded-[10px] px-[11px] py-[9px] text-[13px] leading-normal text-[#e6e8eb]"
              style={{
                background: `color-mix(in srgb, ${brandColor} 17%, #171b21)`,
                border: `1px solid color-mix(in srgb, ${brandColor} 32%, #22262e)`,
              }}
            >
              {m.body}
            </div>
          ),
        )}

        {thinking && (
          <div className="flex items-start gap-2">
            <span className="mt-0.5 grid h-[22px] w-[22px] flex-none place-items-center rounded-[7px] border border-[#22262e] bg-[#0a0c0f]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/mark/aigarage-mark-on-dark.svg" alt="" className="h-[11px] w-[11px]" />
            </span>
            <div className="flex gap-1 rounded-[10px] border border-[#22262e] bg-[#171b21] px-[13px] py-3">
              {[0, 1, 2].map((d) => (
                <span
                  key={d}
                  className="h-[5px] w-[5px] rounded-full bg-[#9aa1ad] animate-pulse motion-reduce:animate-none"
                  style={{ animationDelay: `${d * 0.2}s`, animationDuration: "1.2s" }}
                />
              ))}
            </div>
          </div>
        )}

        {messages.length === 1 && !thinking && (
          <div className="ml-[30px] flex flex-col items-start gap-1.5">
            <span className="font-mono text-[9px] tracking-[.12em] text-[#5a6170]">
              ON THIS PAGE — TRY ONE
            </span>
            {suggestions.map((q) => (
              <button
                key={q}
                onClick={() => void ask(q)}
                className="rounded-full border border-[#2a2f37] bg-[#14181e] px-3 py-[7px] text-left text-[12px] text-[#c6cad1] hover:border-[#3a4049] hover:bg-[#1c2026]"
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Input row */}
      <div className="flex gap-2 border-t border-[#22262e] px-3 py-2.5">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void ask(draft)}
          placeholder="Ask anything about AI Garage…"
          className="flex-1 rounded-lg border border-[#2a2f37] bg-[#0e1116] px-[11px] py-[9px] text-[13px] text-[#e6e8eb] outline-none placeholder:text-[#5a6170]"
        />
        <button
          onClick={() => void ask(draft)}
          aria-label="Send"
          className="grid h-9 w-9 flex-none place-items-center rounded-lg"
          style={{ background: brandColor, color: onBrand }}
        >
          <Send className="h-[15px] w-[15px]" />
        </button>
      </div>

      {/* Footer strip */}
      <div className="flex items-center justify-between border-t border-[#22262e] bg-[#0e1116] px-3.5 py-[7px]">
        <span className="truncate font-mono text-[9px] tracking-[.08em] text-[#5a6170]">
          CONTEXT ATTACHED · {pathname.toUpperCase()} · {role.toUpperCase()}
        </span>
        {unread > 0 && (
          <button onClick={onOpenUnread} className="flex-none font-mono text-[9.5px] tracking-[.08em] text-[#ffb020]">
            {unread} NEW REPL{unread === 1 ? "Y" : "IES"} →
          </button>
        )}
      </div>
    </>
  );
}

// "That helped" dismisses its own row (design specifies the chip, no action).
function ThatHelped() {
  const [helped, setHelped] = useState(false);
  if (helped) return <span className="px-1 py-1.5 text-[11.5px] text-[#5fdd9d]">Glad it helped ✓</span>;
  return (
    <button
      onClick={() => setHelped(true)}
      className="rounded-full border border-[#2a2f37] px-3 py-1.5 text-[11.5px] text-[#9aa1ad] hover:bg-[#1c2026] hover:text-[#e6e8eb]"
    >
      That helped
    </button>
  );
}
