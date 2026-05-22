"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Check } from "lucide-react";
import { markNotificationRead, markAllNotificationsRead } from "@/app/staff/notifications/actions";
import type { StaffNotification } from "@/lib/staff-notifications";

const KIND_DOT: Record<string, string> = {
  "quote.approved": "bg-green-500",
  "quote.declined": "bg-red-500",
  "quote.rebooked": "bg-blue-500",
  "quote.deposit_paid": "bg-emerald-500",
};

function formatRelative(s: string): string {
  const diffMs = Date.now() - new Date(s).getTime();
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function NotificationsBell({
  unreadCount,
  recent,
}: {
  unreadCount: number;
  recent: StaffNotification[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleClick(n: StaffNotification) {
    setOpen(false);
    startTransition(async () => {
      if (!n.read_at) await markNotificationRead(n.id);
      if (n.href) router.push(n.href);
    });
  }

  function handleMarkAllRead() {
    startTransition(async () => {
      await markAllNotificationsRead();
    });
  }

  return (
    <div className="fixed top-3 right-4 z-30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative grid h-10 w-10 place-items-center rounded-full bg-[#15181d] border border-[#2a2f37] text-[#e6e8eb] hover:bg-[#1c2026]"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 grid h-5 min-w-5 px-1 place-items-center rounded-full bg-red-500 text-white text-[10px] font-bold">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* click-outside backdrop */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 mt-2 w-80 max-h-[70vh] overflow-y-auto rounded-lg border border-[#2a2f37] bg-[#15181d] shadow-2xl z-40 text-[#e6e8eb]">
            <div className="px-3 py-2 border-b border-[#2a2f37] flex items-center justify-between">
              <h3 className="text-sm font-semibold">Notifications</h3>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  disabled={pending}
                  className="text-xs text-[#9aa1ad] hover:text-white disabled:opacity-50"
                >
                  Mark all read
                </button>
              )}
            </div>

            {recent.length === 0 ? (
              <p className="px-3 py-6 text-sm text-[#9aa1ad] text-center">No notifications yet.</p>
            ) : (
              <ul className="divide-y divide-[#2a2f37]">
                {recent.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => handleClick(n)}
                      className={`w-full text-left px-3 py-2.5 hover:bg-[#1c2026] flex gap-2 ${n.read_at ? "opacity-60" : ""}`}
                    >
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${KIND_DOT[n.kind] ?? "bg-slate-400"}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{n.title}</div>
                        {n.body && <div className="text-xs text-[#9aa1ad] mt-0.5 line-clamp-2">{n.body}</div>}
                        <div className="text-[10px] text-[#9aa1ad] mt-1">{formatRelative(n.created_at)}</div>
                      </div>
                      {!n.read_at && <Check className="h-3.5 w-3.5 mt-1 text-[#9aa1ad]" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <Link
              href="/staff/notifications"
              onClick={() => setOpen(false)}
              className="block text-center text-xs px-3 py-2 border-t border-[#2a2f37] text-[#9aa1ad] hover:text-white"
            >
              View all →
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
