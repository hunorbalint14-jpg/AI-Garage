"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { SupportTicket, SupportTicketMessage } from "@/lib/support-tickets-shared";
import type { SupportLauncherProps } from "./support-launcher";
import { AssistChat } from "./views/assist-chat";
import { EscalateForm, type EscalateFormState } from "./views/escalate-form";
import { SentView } from "./views/sent-view";
import { TicketList } from "./views/ticket-list";
import { TicketThread } from "./views/ticket-thread";

export type ChatMsg = {
  role: "user" | "assistant";
  body: string;
  // href is null for knowledge-base sources (no manual section to link to).
  source?: { label: string; href: string | null };
};

export type PanelView = "chat" | "escalate" | "sent" | "tickets" | "thread";

type PanelProps = SupportLauncherProps & {
  pathname: string;
  view: PanelView;
  setView: (v: PanelView) => void;
  messages: ChatMsg[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMsg[]>>;
  unread: number;
  thread: { ticket: SupportTicket; messages: SupportTicketMessage[] } | null;
  openThread: (ticketId: string) => Promise<void>;
  onClose: () => void;
};

// Panel chrome: header, backdrop, focus trap, responsive popover (desktop) /
// bottom sheet (mobile), view switching. State lives in the launcher so chat
// history and the open thread survive view changes.
export function SupportPanel(props: PanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const [form, setForm] = useState<EscalateFormState>({
    type: "question",
    subject: "",
    body: "",
    screenshotOn: true,
  });
  const [sentRef, setSentRef] = useState<string | null>(null);

  // Esc closes; rudimentary focus trap keeps Tab inside the dialog.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        props.onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [props]);

  function escalateFromChat() {
    const lastQ = [...props.messages].reverse().find((m) => m.role === "user")?.body ?? "";
    setForm({
      type: "question",
      subject: lastQ.slice(0, 120),
      body: lastQ
        ? `Asked Assist: "${lastQ}"\n\nThe answer didn't fully solve it. What I still need:\n`
        : "",
      screenshotOn: true,
    });
    props.setView("escalate");
  }

  return (
    <>
      {/* Backdrop: transparent on desktop, dimmed behind the mobile sheet. */}
      <div
        className="fixed inset-0 z-40 bg-black/45 sm:bg-transparent max-sm:z-[49]"
        onClick={props.onClose}
        aria-hidden
      />
      <section
        ref={panelRef}
        role="dialog"
        aria-label="Support"
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col overflow-hidden rounded-t-2xl border-t border-[#2a2f37] bg-[#111418] pb-[env(safe-area-inset-bottom)] shadow-[0_24px_64px_rgba(0,0,0,.65)] animate-in fade-in slide-in-from-bottom-6 duration-200 motion-reduce:animate-none sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-12 sm:z-40 sm:max-h-[calc(100vh-74px)] sm:w-[382px] sm:rounded-[14px] sm:border sm:pb-0 sm:slide-in-from-top-1 sm:slide-in-from-bottom-0 sm:zoom-in-[.97] sm:duration-150"
      >
        {/* Mobile grab handle */}
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-[#2a2f37] sm:hidden" />

        {/* Header */}
        <div
          className="flex items-center gap-2.5 border-b border-[#22262e] px-3.5 py-3"
          style={{
            background: `linear-gradient(180deg, color-mix(in srgb, ${props.brandColor} 9%, transparent), transparent)`,
          }}
        >
          <span className="grid h-[26px] w-[26px] flex-none place-items-center rounded-lg border border-[#2a2f37] bg-[#0a0c0f]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/mark/aigarage-mark-on-dark.svg" alt="" className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[13.5px] font-semibold leading-tight text-[#e6e8eb]">
              Support
              <span className="rounded border border-[#5a4218] bg-[#3a2c14] px-1 py-px font-mono text-[8px] tracking-[.1em] text-[#ffb020]">
                BETA
              </span>
            </div>
            <div className="mt-0.5 font-mono text-[9px] tracking-[.1em] text-[#5a6170]">
              ANSWERS FIRST · HUMANS ON STANDBY
            </div>
          </div>
          <button
            onClick={() => props.setView("tickets")}
            className="relative rounded-md border border-[#2a2f37] px-2 py-[5px] font-mono text-[10px] tracking-[.08em] text-[#9aa1ad] hover:bg-[#1c2026] hover:text-[#e6e8eb]"
          >
            TICKETS · {props.openTicketCount}
            {props.unread > 0 && (
              <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full border-2 border-[#111418] bg-[#ef4444]" />
            )}
          </button>
          <button
            onClick={props.onClose}
            aria-label="Close"
            className="grid h-[26px] w-[26px] place-items-center rounded-md text-[#5a6170] hover:bg-[#1c2026] hover:text-[#e6e8eb]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {props.view === "chat" && (
          <AssistChat
            pathname={props.pathname}
            role={props.role}
            brandColor={props.brandColor}
            onBrand={props.onBrand}
            messages={props.messages}
            setMessages={props.setMessages}
            unread={props.unread}
            onEscalate={escalateFromChat}
            onOpenUnread={() => props.latestUnread && void props.openThread(props.latestUnread.ticketId)}
          />
        )}
        {props.view === "escalate" && (
          <EscalateForm
            pathname={props.pathname}
            role={props.role}
            branchName={props.branchName}
            buildSha={props.buildSha}
            brandColor={props.brandColor}
            onBrand={props.onBrand}
            form={form}
            setForm={setForm}
            onBack={() => props.setView("chat")}
            onSent={(ref) => {
              setSentRef(ref);
              props.setView("sent");
            }}
          />
        )}
        {props.view === "sent" && (
          <SentView
            sentRef={sentRef}
            userEmail={props.userEmail}
            brandColor={props.brandColor}
            onBrand={props.onBrand}
            onViewTickets={() => props.setView("tickets")}
            onDone={() => props.setView("chat")}
          />
        )}
        {props.view === "tickets" && (
          <TicketList onBack={() => props.setView("chat")} onOpen={(id) => void props.openThread(id)} />
        )}
        {props.view === "thread" && (
          <TicketThread
            thread={props.thread}
            brandColor={props.brandColor}
            onBrand={props.onBrand}
            onBack={() => props.setView("tickets")}
            onReloaded={(id) => void props.openThread(id)}
          />
        )}
      </section>
    </>
  );
}
