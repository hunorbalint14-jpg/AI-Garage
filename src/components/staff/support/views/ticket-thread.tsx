"use client";

import { useState, useTransition } from "react";
import { Send } from "lucide-react";
import type { SupportTicket, SupportTicketMessage } from "@/lib/support-tickets-shared";
import { TYPE_LABELS, shortTicketRef, isTerminalForStaff } from "@/lib/support-tickets-shared";
import { replyToTicketAction } from "@/app/staff/support-widget/actions";
import { StatusPill } from "../status-pill";

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TicketThread({
  thread,
  brandColor,
  onBrand,
  onBack,
  onReloaded,
}: {
  thread: { ticket: SupportTicket; messages: SupportTicketMessage[] } | null;
  brandColor: string;
  onBrand: string;
  onBack: () => void;
  onReloaded: (ticketId: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!thread) {
    return (
      <div className="p-6 text-center font-mono text-[10px] text-[#5a6170]">LOADING…</div>
    );
  }

  const { ticket, messages } = thread;
  const terminal = isTerminalForStaff(ticket.status);

  function sendReply() {
    const body = draft.trim();
    if (!body || pending) return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("body", body);
      const result = await replyToTicketAction(ticket.id, fd);
      if ("error" in result) setError(result.error);
      else {
        setDraft("");
        onReloaded(ticket.id); // refetch the thread (and status flip)
      }
    });
  }

  return (
    <>
      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain p-3.5">
        <button
          onClick={onBack}
          className="self-start font-mono text-[10px] tracking-[.08em] text-[#5a6170] hover:text-[#e6e8eb]"
        >
          ← ALL TICKETS
        </button>
        <div>
          <div className="text-[13.5px] font-semibold text-[#e6e8eb]">{ticket.subject}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] text-[#5a6170]">{shortTicketRef(ticket.id)}</span>
            <StatusPill status={ticket.status} />
            <span className="font-mono text-[9px] uppercase tracking-[.08em] text-[#5a6170]">
              {TYPE_LABELS[ticket.type]} · {fmtWhen(ticket.created_at)}
            </span>
          </div>
        </div>

        {messages.map((m) => {
          const fromPlatform = m.author_kind === "platform_admin";
          return (
            <div
              key={m.id}
              className="rounded-[10px] px-[11px] py-[9px]"
              style={
                fromPlatform
                  ? {
                      border: `1px solid color-mix(in srgb, ${brandColor} 30%, #22262e)`,
                      background: `color-mix(in srgb, ${brandColor} 7%, #14181e)`,
                    }
                  : { border: "1px solid #22262e", background: "#171b21" }
              }
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span
                  className="text-[11.5px] font-semibold"
                  style={{ color: fromPlatform ? "#e6e8eb" : "#9aa1ad" }}
                >
                  {fromPlatform ? "AI Garage Support" : m.author_name ?? "Team member"}
                </span>
                <span className="text-[10px] text-[#5a6170]">{fmtWhen(m.created_at)}</span>
              </div>
              <p className="m-0 whitespace-pre-wrap text-[12.5px] leading-[1.55] text-[#d6dae0]">
                {m.body}
              </p>
            </div>
          );
        })}

        {ticket.status === "resolved" && (
          <div className="text-center font-mono text-[9px] tracking-[.1em] text-[#5a6170]">
            RESOLVED — REPLYING REOPENS THE TICKET
          </div>
        )}
      </div>

      {terminal ? (
        <div className="border-t border-[#22262e] px-3.5 py-3 text-center text-[11.5px] text-[#5a6170]">
          This ticket is closed — raise a new one if you need more help.
        </div>
      ) : (
        <div className="border-t border-[#22262e] px-3 py-2.5">
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendReply()}
              placeholder="Reply to the team…"
              className="flex-1 rounded-lg border border-[#2a2f37] bg-[#0e1116] px-[11px] py-[9px] text-[16px] text-[#e6e8eb] outline-none placeholder:text-[#5a6170] sm:text-[13px]"
            />
            <button
              onClick={sendReply}
              disabled={pending}
              aria-label="Send reply"
              className="grid h-9 w-9 flex-none place-items-center rounded-lg disabled:opacity-50"
              style={{ background: brandColor, color: onBrand }}
            >
              <Send className="h-[15px] w-[15px]" />
            </button>
          </div>
          {error && <p className="mb-0 mt-1.5 text-[11.5px] text-[#ff7b7b]">{error}</p>}
        </div>
      )}
    </>
  );
}
