"use client";

import { useState } from "react";
import Link from "next/link";
import type { TranscriptMessage } from "@/lib/receptionist/agent";

export type ConversationView = {
  id: string;
  customerPhone: string;
  customerName: string | null;
  channel: string;
  status: string;
  source: string;
  bookingId: string | null;
  messages: TranscriptMessage[];
  startedAt: string;
  lastMessageAt: string;
};

const STATUS_STYLE: Record<string, string> = {
  active: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  handed_off: "bg-amber-100 text-amber-700",
  expired: "bg-gray-100 text-gray-600",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  completed: "Booked",
  handed_off: "Needs human",
  expired: "Expired",
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ConversationList({ conversations }: { conversations: ConversationView[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (conversations.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
        No conversations yet. They&apos;ll appear here when customers text the receptionist number
        or the agent texts back after a missed call.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {conversations.map((c) => {
        const isOpen = openId === c.id;
        return (
          <div key={c.id} className="rounded-lg border bg-card">
            <button
              type="button"
              onClick={() => setOpenId(isOpen ? null : c.id)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  {c.customerName ?? c.customerPhone}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {c.channel === "whatsapp" ? "WhatsApp" : "SMS"}
                    {c.source === "missed_call" ? " · missed call" : ""}
                  </span>
                </span>
                <span className="block text-xs text-muted-foreground">
                  {c.messages.length} message{c.messages.length === 1 ? "" : "s"} · last{" "}
                  {fmtTime(c.lastMessageAt)}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {c.bookingId && (
                  <Link
                    href={`/staff/bookings/${c.bookingId}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs underline"
                  >
                    View booking
                  </Link>
                )}
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[c.status] ?? ""}`}
                >
                  {STATUS_LABEL[c.status] ?? c.status}
                </span>
              </span>
            </button>

            {isOpen && (
              <div className="flex flex-col gap-2 border-t px-4 py-3">
                {c.messages.length === 0 && (
                  <p className="text-xs text-muted-foreground">No messages recorded.</p>
                )}
                {c.messages.map((m, i) => (
                  <div
                    key={i}
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                      m.role === "user"
                        ? "self-start bg-muted"
                        : "self-end bg-primary/10"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{m.content}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {m.role === "user" ? "Customer" : "Receptionist"} · {fmtTime(m.at)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
