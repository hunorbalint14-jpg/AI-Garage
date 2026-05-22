"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { markNotificationRead, markAllNotificationsRead } from "./actions";
import type { StaffNotification } from "@/lib/staff-notifications";

const KIND_DOT: Record<string, string> = {
  "quote.approved": "bg-green-500",
  "quote.declined": "bg-red-500",
  "quote.rebooked": "bg-blue-500",
  "quote.deposit_paid": "bg-emerald-500",
};

function formatRelative(s: string): string {
  return new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function NotificationsList({ notifications }: { notifications: StaffNotification[] }) {
  const [pending, startTransition] = useTransition();
  const [items, setItems] = useState(notifications);
  const unread = items.filter((n) => !n.read_at).length;

  function handleRead(id: string) {
    startTransition(async () => {
      await markNotificationRead(id);
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
    });
  }

  function handleMarkAllRead() {
    startTransition(async () => {
      await markAllNotificationsRead();
      const now = new Date().toISOString();
      setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    });
  }

  return (
    <div className="rounded-lg border">
      {unread > 0 && (
        <div className="px-4 py-2 border-b flex items-center justify-between bg-muted/30">
          <span className="text-sm text-muted-foreground">{unread} unread</span>
          <button
            type="button"
            onClick={handleMarkAllRead}
            disabled={pending}
            className="text-xs underline disabled:opacity-50"
          >
            Mark all as read
          </button>
        </div>
      )}
      <ul className="divide-y">
        {items.map((n) => (
          <li key={n.id} className={`px-4 py-3 flex gap-3 items-start ${n.read_at ? "opacity-60" : ""}`}>
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${KIND_DOT[n.kind] ?? "bg-slate-400"}`} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{n.title}</div>
              {n.body && <p className="text-sm text-muted-foreground mt-0.5">{n.body}</p>}
              <div className="text-xs text-muted-foreground mt-1">{formatRelative(n.created_at)}</div>
              {n.href && (
                <Link href={n.href} className="text-xs text-primary underline mt-1 inline-block">
                  Open →
                </Link>
              )}
            </div>
            {!n.read_at && (
              <button
                type="button"
                onClick={() => handleRead(n.id)}
                disabled={pending}
                className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                aria-label="Mark read"
              >
                <Check className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
