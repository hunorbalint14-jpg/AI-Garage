"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LifeBuoy } from "lucide-react";
import type { SupportTicket, SupportTicketMessage } from "@/lib/support-tickets-shared";
import type { UnreadTicketReply } from "@/lib/staff-notifications";
import { getThreadAction, markTicketNotificationsReadAction } from "@/app/staff/support-widget/actions";
import { SupportPanel, type ChatMsg, type PanelView } from "./support-panel";
import { useSupportPath } from "./use-support-context";

export type SupportLauncherProps = {
  brandColor: string;
  onBrand: string;
  firstName: string;
  userEmail: string | null;
  role: string;
  branchName: string;
  buildSha: string | null;
  openTicketCount: number;
  unreadReplyCount: number;
  latestUnread: UnreadTicketReply | null;
};

// Floating support entry point: launcher button + unread badge + peek toast +
// the popover panel. Lives in the fixed top-right cluster beside the bell
// (mounted from the staff layout). Chat history persists for the session;
// opening always lands on the chat view.
export function SupportLauncher(props: SupportLauncherProps) {
  const pathname = useSupportPath();
  const searchParams = useSearchParams();
  const launcherRef = useRef<HTMLButtonElement>(null);

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<PanelView>("chat");
  const [unread, setUnread] = useState(props.unreadReplyCount);
  const [peek, setPeek] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      role: "assistant",
      body: `Hi ${props.firstName} — ask me anything about AI Garage. I answer from the manual, and hand you to the team when it needs a human.`,
    },
  ]);
  const [thread, setThread] = useState<{ ticket: SupportTicket; messages: SupportTicketMessage[] } | null>(null);
  const [assistPrefill, setAssistPrefill] = useState<string | null>(null);

  const openThread = useCallback(
    async (ticketId: string) => {
      setOpen(true);
      setView("thread");
      const result = await getThreadAction(ticketId);
      if ("error" in result) {
        setView("tickets");
        return;
      }
      setThread(result);
      const { cleared } = await markTicketNotificationsReadAction(ticketId);
      if (cleared > 0) setUnread((u) => Math.max(0, u - cleared));
    },
    [],
  );

  // Deep link: /staff?ticket=<id> (email links + notification archive rows).
  // Reactive so client-side navigations open it too; the param is stripped
  // after handling so refreshes don't reopen.
  const deepLinkTicket = searchParams.get("ticket");
  useEffect(() => {
    if (!deepLinkTicket) return;
    // Deferred so the state updates happen in a callback, not synchronously
    // inside the effect (react-hooks/set-state-in-effect).
    queueMicrotask(() => void openThread(deepLinkTicket));
    const url = new URL(window.location.href);
    url.searchParams.delete("ticket");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, [deepLinkTicket, openThread]);

  // Deep link: /staff?assist=<question> (setup-checklist "Ask AI" affordances).
  // Opens the chat with the question pre-filled — the user presses send;
  // never auto-sent. Same consume-and-strip dance as ?ticket= above.
  const deepLinkAssist = searchParams.get("assist");
  useEffect(() => {
    if (!deepLinkAssist) return;
    queueMicrotask(() => {
      setAssistPrefill(deepLinkAssist);
      setView("chat");
      setOpen(true);
    });
    const url = new URL(window.location.href);
    url.searchParams.delete("assist");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, [deepLinkAssist]);

  // Peek toast: once per newest unread reply (localStorage-guarded), <24h old.
  useEffect(() => {
    const n = props.latestUnread;
    if (!n || open) return;
    if (Date.now() - new Date(n.createdAt).getTime() > 24 * 60 * 60 * 1000) return;
    const key = `support-peek-${n.id}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
    const show = setTimeout(() => setPeek(true), 1200);
    const hide = setTimeout(() => setPeek(false), 1200 + 6700); // entry + 6.4s bar
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
    // Run once per notification id, not on open/close.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.latestUnread?.id]);

  function toggleOpen() {
    setPeek(false);
    setOpen((v) => {
      const next = !v;
      if (next) setView("chat"); // opening always resets to chat (history kept)
      return next;
    });
  }

  function close() {
    setOpen(false);
    launcherRef.current?.focus();
  }

  return (
    <div className="relative" data-support-widget>
      <button
        ref={launcherRef}
        type="button"
        onClick={toggleOpen}
        aria-label="Support"
        className="relative grid h-10 w-10 place-items-center rounded-full border border-[#2a2f37] bg-[#15181d] text-[#e6e8eb] hover:bg-[#1c2026]"
      >
        <LifeBuoy className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 grid h-[17px] min-w-[17px] place-items-center rounded-full border-2 border-[#0e1014] bg-[#ef4444] px-1 text-[10px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {/* Peek toast */}
      {peek && !open && props.latestUnread && (
        <div className="fixed inset-x-3 top-14 z-[39] overflow-hidden rounded-xl border border-[#2a2f37] bg-[#15181d] shadow-[0_20px_48px_rgba(0,0,0,.6)] animate-in fade-in slide-in-from-right-5 duration-300 motion-reduce:animate-none sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[324px]">
          <div className="flex gap-2.5 p-3 pb-2.5">
            <span className="grid h-7 w-7 flex-none place-items-center rounded-lg border border-[#2a2f37] bg-[#0a0c0f]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/mark/aigarage-mark-on-dark.svg" alt="" className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-semibold text-[#e6e8eb]">AI Garage Support replied</div>
              <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-[#9aa1ad]">
                {props.latestUnread.snippet}
              </div>
              <div className="mt-1.5 flex gap-3">
                <button
                  onClick={() => {
                    setPeek(false);
                    void openThread(props.latestUnread!.ticketId);
                  }}
                  style={{ color: props.brandColor }}
                  className="text-[11.5px] font-semibold"
                >
                  View reply →
                </button>
                <button onClick={() => setPeek(false)} className="text-[11.5px] text-[#5a6170]">
                  Dismiss
                </button>
              </div>
            </div>
          </div>
          <div className="h-0.5 bg-[#22262e]">
            <div
              className="h-full motion-reduce:animate-none"
              style={{ background: props.brandColor, animation: "support-shrink-x 6.4s linear forwards" }}
            />
          </div>
        </div>
      )}

      {open && (
        <SupportPanel
          {...props}
          pathname={pathname}
          view={view}
          setView={setView}
          messages={messages}
          setMessages={setMessages}
          unread={unread}
          thread={thread}
          openThread={openThread}
          onClose={close}
          assistPrefill={assistPrefill}
          onAssistPrefillConsumed={() => setAssistPrefill(null)}
        />
      )}
    </div>
  );
}
