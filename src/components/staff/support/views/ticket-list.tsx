"use client";

import { useEffect, useState } from "react";
import type { SupportTicket } from "@/lib/support-tickets-shared";
import { TYPE_LABELS, shortTicketRef } from "@/lib/support-tickets-shared";
import { listMyTicketsAction } from "@/app/staff/support-widget/actions";
import { StatusPill } from "../status-pill";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

export function TicketList({
  onBack,
  onOpen,
}: {
  onBack: () => void;
  onOpen: (ticketId: string) => void;
}) {
  const [rows, setRows] = useState<SupportTicket[] | null>(null);
  const [unreadIds, setUnreadIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    void listMyTicketsAction().then((r) => {
      setRows(r.rows);
      setUnreadIds(new Set(r.unreadTicketIds));
    });
  }, []);

  return (
    <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3.5">
      <button
        onClick={onBack}
        className="self-start font-mono text-[10px] tracking-[.08em] text-[#5a6170] hover:text-[#e6e8eb]"
      >
        ← BACK TO ASSIST
      </button>
      <div className="text-[14px] font-semibold text-[#e6e8eb]">Your tickets</div>

      {rows === null ? (
        <div className="py-6 text-center font-mono text-[10px] text-[#5a6170]">LOADING…</div>
      ) : rows.length === 0 ? (
        <div className="py-6 text-center text-[12px] text-[#9aa1ad]">
          No tickets yet — raise one from the chat when you&apos;re stuck.
        </div>
      ) : (
        <div>
          {rows.map((t) => (
            <button
              key={t.id}
              onClick={() => onOpen(t.id)}
              className="block w-full border-t border-[#1c2026] px-1 py-2.5 text-left first:border-t-0 hover:bg-[#171b21]"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-[#5a6170]">{shortTicketRef(t.id)}</span>
                <StatusPill status={t.status} />
                {unreadIds.has(t.id) && (
                  <span className="rounded-full border border-[#5a4218] bg-[#3a2c14] px-1.5 py-px font-mono text-[9px] text-[#ffb020]">
                    1 NEW
                  </span>
                )}
                <span className="ml-auto flex-none text-[10.5px] text-[#5a6170]">
                  {relativeTime(t.last_activity_at)}
                </span>
              </div>
              <div className="mt-1 truncate text-[13px] font-medium text-[#e6e8eb]">{t.subject}</div>
              <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[.08em] text-[#5a6170]">
                {TYPE_LABELS[t.type]}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
