/**
 * REFERENCE IMPLEMENTATION — Support Widget, Variant A "Popover".
 * Translated from the approved HTML prototype (see ../prototype/). Adapt into
 * src/components/staff/support/ — do not ship verbatim. Stubs marked TODO wire
 * up to the real server actions / API described in ../README.md.
 *
 * Conventions match the AI-Garage repo: client component, Tailwind arbitrary
 * values on the dark staff shell palette, lucide-react icons, no state library.
 */
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { LifeBuoy, Send, X, Check } from "lucide-react";

// TODO: import from "@/app/staff/support-widget/actions"
//   createSupportTicketAction, replyToTicketAction, listMyOrgTickets, getTicketThread
// TODO: unread count + peek payload come from the layout (staff_notifications, kinds ticket.*)

/* ── types (mirror src/lib/support-tickets-shared.ts) ─────────────────── */
type TicketType = "bug" | "question" | "feature_request";
type TicketStatus = "open" | "needs_info" | "in_progress" | "planned" | "resolved" | "closed" | "declined";
type ChatMsg = { role: "user" | "assistant"; body: string; source?: { label: string; href: string } };
type View = "chat" | "escalate" | "sent" | "tickets" | "thread";

const TYPE_LABELS: Record<TicketType, string> = { bug: "Bug", question: "Question", feature_request: "Feature request" };
// Dark-adjusted status pills (matches globals.css .dark overrides)
const STATUS_PILL: Record<TicketStatus, { bg: string; cl: string; label: string }> = {
  open:        { bg: "rgba(120,53,15,.3)",   cl: "#fcd34d", label: "Open" },
  needs_info:  { bg: "rgba(30,58,138,.3)",   cl: "#93c5fd", label: "Needs info" },
  in_progress: { bg: "rgba(76,29,149,.35)",  cl: "#d8b4fe", label: "In progress" },
  planned:     { bg: "rgba(12,74,110,.4)",   cl: "#7dd3fc", label: "Planned" },
  resolved:    { bg: "rgba(20,83,45,.35)",   cl: "#86efac", label: "Resolved" },
  closed:      { bg: "rgba(255,255,255,.06)", cl: "#d1d5db", label: "Closed" },
  declined:    { bg: "rgba(127,29,29,.25)",  cl: "#fca5a5", label: "Declined" },
};

// Route-contextual suggestion chips; extend per module. Key = first path segment after /staff.
const SUGGESTIONS: Record<string, string[]> = {
  "": ["Why is a vehicle in the attention queue?", "How do I set up bays?", "Change Saturday opening hours"],
  bookings: ["Why can't I book outside business hours?", "How do bays map to the calendar?"],
  quotes: ["How do quote reminders send?", "Convert an approved quote to a booking"],
};

export function SupportLauncher({
  brandColor,
  onBrand, // precompute with onBrandColor(brandColor) from staff-modules
  firstName,
  userEmail,
  role,
  branchSlug,
  buildSha,
  openTicketCount,
  unreadReplyCount,
}: {
  brandColor: string;
  onBrand: string;
  firstName: string;
  userEmail: string | null;
  role: string;
  branchSlug: string;
  buildSha: string | null;
  openTicketCount: number;
  unreadReplyCount: number;
}) {
  const pathname = usePathname() || "/staff";
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("chat");
  const [unread, setUnread] = useState(unreadReplyCount);
  const [peek, setPeek] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /* chat state */
  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: "assistant", body: `Hi ${firstName} — ask me anything about AI Garage. I answer from the manual, and hand you to the team when it needs a human.` },
  ]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);

  /* escalate form state */
  const [form, setForm] = useState<{ type: TicketType; subject: string; body: string; screenshot: boolean }>({
    type: "question", subject: "", body: "", screenshot: true,
  });
  const [sentRef, setSentRef] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /* peek toast: once per newest unread reply (guard with localStorage key) */
  useEffect(() => {
    if (unread === 0) return;
    const t1 = setTimeout(() => setPeek(true), 1200);
    const t2 = setTimeout(() => setPeek(false), 8000); // 6.4s bar + entry
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [unread]);

  /* esc closes; focus input on open */
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [open, view]);

  function ask(q: string) {
    if (!q.trim()) return;
    setMessages((m) => [...m, { role: "user", body: q.trim() }]);
    setDraft("");
    setThinking(true);
    // TODO: POST /api/support/assist { question: q, path: pathname } → { answer, sources }
    // setMessages((m) => [...m, { role: "assistant", body: answer, source: sources[0] }]);
    // setThinking(false);
  }

  function openEscalate() {
    const lastQ = [...messages].reverse().find((m) => m.role === "user")?.body ?? "";
    setForm({
      type: "question",
      subject: lastQ.slice(0, 120),
      body: lastQ ? `Asked Assist: "${lastQ}"\n\nThe answer didn't fully solve it. What I still need:\n` : "",
      screenshot: true,
    });
    setView("escalate");
  }

  function submitTicket() {
    startTransition(async () => {
      // TODO: capture screenshot on form OPEN (not here — the panel covers the page),
      // upload via signed action → context.screenshot_path; add Sentry.lastEventId().
      // const res = await createSupportTicketAction(formData) — reuse existing validation copy.
      setSentRef("#3F2A9C1B"); // TODO: shortTicketRef(result.ticket.id)
      setView("sent");
    });
  }

  const mono = "font-mono tracking-[.08em]";
  const chip = "rounded-[4px] border border-[#22262e] bg-[#0e1116] px-[7px] py-[3px] font-mono text-[9px] text-[#9aa1ad]";

  return (
    // Mount beside the bell inside the shared cluster:
    // <div className="fixed top-3 right-4 z-30 flex items-center gap-2"> <SupportLauncher/> <NotificationsBell/> </div>
    <div className="relative">
      {/* ── Launcher ── */}
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setView("chat"); setPeek(false); }}
        aria-label="Support"
        className="relative grid h-10 w-10 place-items-center rounded-full bg-[#15181d] border border-[#2a2f37] text-[#e6e8eb] hover:bg-[#1c2026]"
      >
        <LifeBuoy className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white border-2 border-[#0e1014]">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {/* ── Peek toast ── */}
      {peek && !open && (
        <div className="absolute right-0 top-12 w-[324px] overflow-hidden rounded-xl border border-[#2a2f37] bg-[#15181d] shadow-2xl animate-in slide-in-from-right-5 fade-in duration-300 z-[39]">
          <div className="flex gap-2.5 p-3 pb-2.5">
            <span className="grid h-7 w-7 flex-none place-items-center rounded-lg bg-[#0a0c0f] border border-[#2a2f37]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/aigarage-mark-on-brand.svg" alt="" className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-semibold text-[#e6e8eb]">AI Garage Support replied</div>
              <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-[#9aa1ad]">
                {/* TODO: newest unread ticket.reply notification body */}
              </div>
              <div className="mt-1.5 flex gap-3">
                <button onClick={() => { setOpen(true); setView("thread"); setUnread(0); setPeek(false); /* TODO markNotificationRead */ }} style={{ color: brandColor }} className="text-[11.5px] font-semibold">View reply →</button>
                <button onClick={() => setPeek(false)} className="text-[11.5px] text-[#5a6170]">Dismiss</button>
              </div>
            </div>
          </div>
          <div className="h-0.5 bg-[#22262e]">
            <div className="h-full origin-left animate-[shrinkX_6.4s_linear_forwards]" style={{ background: brandColor }} />
            {/* @keyframes shrinkX { from{width:100%} to{width:0} } */}
          </div>
        </div>
      )}

      {/* ── Popover ── */}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <section
            role="dialog"
            aria-label="Support"
            className="absolute right-0 top-12 z-[41] flex w-[382px] max-h-[calc(100vh-74px)] flex-col overflow-hidden rounded-[14px] border border-[#2a2f37] bg-[#111418] shadow-2xl animate-in fade-in slide-in-from-top-1 zoom-in-[.97] duration-150"
          >
            {/* header */}
            <div className="flex items-center gap-2.5 border-b border-[#22262e] px-3.5 py-3" style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${brandColor} 9%, transparent), transparent)` }}>
              <span className="grid h-[26px] w-[26px] flex-none place-items-center rounded-lg bg-[#0a0c0f] border border-[#2a2f37]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/aigarage-mark-on-brand.svg" alt="" className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold leading-tight text-[#e6e8eb]">Support</div>
                <div className={`${mono} mt-0.5 text-[9px] text-[#5a6170]`}>ANSWERS FIRST · HUMANS ON STANDBY</div>
              </div>
              <button onClick={() => setView("tickets")} className={`${mono} relative rounded-md border border-[#2a2f37] px-2 py-[5px] text-[10px] text-[#9aa1ad] hover:bg-[#1c2026] hover:text-[#e6e8eb]`}>
                TICKETS · {openTicketCount}
                {unread > 0 && <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-red-500 border-2 border-[#111418]" />}
              </button>
              <button onClick={() => setOpen(false)} aria-label="Close" className="grid h-[26px] w-[26px] place-items-center rounded-md text-[#5a6170] hover:bg-[#1c2026] hover:text-[#e6e8eb]"><X className="h-3.5 w-3.5" /></button>
            </div>

            {/* ── view: chat ── */}
            {view === "chat" && (
              <>
                <div className="flex min-h-[230px] max-h-[390px] flex-1 flex-col gap-2.5 overflow-y-auto p-3.5">
                  {messages.map((m, i) =>
                    m.role === "assistant" ? (
                      <div key={i} className="flex flex-col gap-2">
                        <div className="flex items-start gap-2">
                          <span className="mt-0.5 grid h-[22px] w-[22px] flex-none place-items-center rounded-[7px] bg-[#0a0c0f] border border-[#22262e]">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src="/brand/aigarage-mark-on-brand.svg" alt="" className="h-[11px] w-[11px]" />
                          </span>
                          <div className="max-w-[84%] rounded-[10px] border border-[#22262e] bg-[#171b21] px-[11px] py-[9px] text-[13px] leading-[1.55] text-[#d6dae0]">
                            {m.body}
                            {m.source && (
                              <div className="mt-2"><a href={m.source.href} className={`${mono} inline-block rounded border border-[#2a2f37] bg-[#0e1116] px-[7px] py-[3px] text-[9px] text-[#9aa1ad] no-underline`}>{m.source.label} ↗</a></div>
                            )}
                          </div>
                        </div>
                        {/* post-answer actions on the latest answer */}
                        {i === messages.length - 1 && m.source && !thinking && (
                          <div className="ml-[30px] flex flex-wrap gap-1.5">
                            <button className="rounded-full border border-[#2a2f37] px-3 py-1.5 text-[11.5px] text-[#9aa1ad] hover:bg-[#1c2026] hover:text-[#e6e8eb]">That helped</button>
                            <button onClick={openEscalate} className="rounded-full px-3 py-1.5 text-[11.5px] font-semibold text-[#e6e8eb]" style={{ border: `1px solid color-mix(in srgb, ${brandColor} 55%, #2a2f37)`, background: `color-mix(in srgb, ${brandColor} 12%, transparent)` }}>Still stuck — raise a ticket →</button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div key={i} className="self-end max-w-[84%] rounded-[10px] px-[11px] py-[9px] text-[13px] leading-normal text-[#e6e8eb]" style={{ background: `color-mix(in srgb, ${brandColor} 17%, #171b21)`, border: `1px solid color-mix(in srgb, ${brandColor} 32%, #22262e)` }}>{m.body}</div>
                    ),
                  )}
                  {thinking && (
                    <div className="flex items-center gap-2">
                      <span className="grid h-[22px] w-[22px] flex-none place-items-center rounded-[7px] bg-[#0a0c0f] border border-[#22262e]" />
                      <div className="flex gap-1 rounded-[10px] border border-[#22262e] bg-[#171b21] px-[13px] py-3">
                        {[0, 1, 2].map((d) => <span key={d} className="h-[5px] w-[5px] rounded-full bg-[#9aa1ad] animate-pulse" style={{ animationDelay: `${d * 0.2}s` }} />)}
                      </div>
                    </div>
                  )}
                  {messages.length === 1 && !thinking && (
                    <div className="ml-[30px] flex flex-col items-start gap-1.5">
                      <span className={`${mono} text-[9px] tracking-[.12em] text-[#5a6170]`}>ON THIS PAGE — TRY ONE</span>
                      {(SUGGESTIONS[pathname.split("/")[2] ?? ""] ?? SUGGESTIONS[""]).map((q) => (
                        <button key={q} onClick={() => ask(q)} className="rounded-full border border-[#2a2f37] bg-[#14181e] px-3 py-[7px] text-left text-[12px] text-[#c6cad1] hover:border-[#3a4049] hover:bg-[#1c2026]">{q}</button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-2 border-t border-[#22262e] px-3 py-2.5">
                  <input ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask(draft)} placeholder="Ask anything about AI Garage…" className="flex-1 rounded-lg border border-[#2a2f37] bg-[#0e1116] px-[11px] py-[9px] text-[13px] text-[#e6e8eb] outline-none placeholder:text-[#5a6170]" />
                  <button onClick={() => ask(draft)} aria-label="Send" className="grid h-9 w-9 flex-none place-items-center rounded-lg" style={{ background: brandColor, color: onBrand }}><Send className="h-[15px] w-[15px]" /></button>
                </div>
                <div className="flex items-center justify-between border-t border-[#22262e] bg-[#0e1116] px-3.5 py-[7px]">
                  <span className={`${mono} text-[9px] text-[#5a6170]`}>CONTEXT ATTACHED · {pathname.toUpperCase()} · {role.toUpperCase()}</span>
                  {unread > 0 && <button onClick={() => { setView("thread"); setUnread(0); }} className={`${mono} text-[9.5px] text-[#ffb020]`}>1 NEW REPLY →</button>}
                </div>
              </>
            )}

            {/* ── view: escalate ── */}
            {view === "escalate" && (
              <div className="flex flex-1 flex-col gap-[11px] overflow-y-auto p-3.5">
                <button onClick={() => setView("chat")} className={`${mono} self-start text-[10px] text-[#5a6170] hover:text-[#e6e8eb]`}>← BACK TO ASSIST</button>
                <div className="text-[14px] font-semibold text-[#e6e8eb]">Raise a ticket</div>
                <div className="flex gap-1.5">
                  {(Object.keys(TYPE_LABELS) as TicketType[]).map((t) => (
                    <button key={t} onClick={() => setForm((f) => ({ ...f, type: t }))} className="rounded-[7px] px-[11px] py-[7px] text-[12px]" style={form.type === t ? { border: `1px solid ${brandColor}`, background: `color-mix(in srgb, ${brandColor} 14%, transparent)`, color: "#e6e8eb", fontWeight: 600 } : { border: "1px solid #2a2f37", color: "#9aa1ad" }}>{TYPE_LABELS[t]}</button>
                  ))}
                </div>
                <label className={`${mono} text-[9px] tracking-[.12em] text-[#5a6170]`}>SUBJECT
                  <input value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} minLength={3} maxLength={150} className="mt-1 w-full rounded-lg border border-[#2a2f37] bg-[#0e1116] px-[11px] py-[9px] font-sans text-[13px] tracking-normal text-[#e6e8eb] outline-none" />
                </label>
                <label className={`${mono} text-[9px] tracking-[.12em] text-[#5a6170]`}>WHAT&apos;S GOING ON?
                  <textarea rows={5} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} maxLength={10000} className="mt-1 w-full resize-y rounded-lg border border-[#2a2f37] bg-[#0e1116] px-[11px] py-[9px] font-sans text-[13px] leading-normal tracking-normal text-[#e6e8eb] outline-none" />
                </label>
                <div className="rounded-lg border border-dashed border-[#2a2f37] p-2.5">
                  <div className={`${mono} mb-[7px] text-[9px] tracking-[.12em] text-[#5a6170]`}>ATTACHED AUTOMATICALLY</div>
                  <div className="flex flex-wrap gap-[5px]">
                    <span className={chip}>ROUTE {pathname.toUpperCase()}</span>
                    <span className={chip}>BRANCH {branchSlug.toUpperCase()}</span>
                    <span className={chip}>ROLE {role.toUpperCase()}</span>
                    {buildSha && <span className={chip}>BUILD {buildSha}</span>}
                    <span className={chip}>SENTRY · {/* TODO lastEventId */}NONE IN LAST HOUR</span>
                    <button onClick={() => setForm((f) => ({ ...f, screenshot: !f.screenshot }))} className="inline-flex items-center gap-[5px] rounded-[4px] bg-[#0e1116] px-[7px] py-[3px] font-mono text-[9px]" style={form.screenshot ? { border: `1px solid ${brandColor}`, color: "#e6e8eb" } : { border: "1px solid #2a2f37", color: "#5a6170" }}>
                      <span className="inline-block h-[10px] w-[15px] rounded-[2px] border border-[#3a4049] bg-gradient-to-br from-[#1c2026] to-[#2a313b]" />
                      SCREENSHOT · {form.screenshot ? "ATTACHED" : "OFF"}
                    </button>
                  </div>
                </div>
                <button onClick={submitTicket} disabled={pending} className="rounded-lg py-2.5 text-[13px] font-semibold disabled:opacity-50" style={{ background: brandColor, color: onBrand }}>{pending ? "Sending…" : "Send to AI Garage"}</button>
                <div className={`${mono} text-center text-[9px] text-[#5a6170]`}>REPLIES LAND HERE AND BY EMAIL</div>
              </div>
            )}

            {/* ── view: sent ── */}
            {view === "sent" && (
              <div className="flex flex-col items-center gap-2.5 px-6 py-[30px] text-center">
                <span className="grid h-[38px] w-[38px] place-items-center rounded-full border border-[#2d5a3f] bg-[#13301f] text-[#5fdd9d]"><Check className="h-[17px] w-[17px]" /></span>
                <div className="text-[15px] font-semibold text-[#e6e8eb]">Ticket sent</div>
                <span className={`${mono} rounded-[5px] border border-[#2a2f37] bg-[#0e1116] px-[9px] py-1 text-[11px] text-[#9aa1ad]`}>{sentRef}</span>
                <p className="m-0 text-[12px] leading-[1.55] text-[#9aa1ad]">The AI Garage team replies here and at {userEmail} — typically the same working day.</p>
                <div className="mt-1 flex gap-2">
                  <button onClick={() => setView("tickets")} className="rounded-lg border border-[#2a2f37] px-3.5 py-2 text-[12.5px] text-[#9aa1ad] hover:bg-[#1c2026] hover:text-[#e6e8eb]">View my tickets</button>
                  <button onClick={() => setView("chat")} className="rounded-lg px-4 py-2 text-[12.5px] font-semibold" style={{ background: brandColor, color: onBrand }}>Done</button>
                </div>
              </div>
            )}

            {/* ── views: tickets + thread ──
                Render rows from listMyOrgTickets(): ref (shortTicketRef, mono 10px #5a6170),
                STATUS_PILL pill, amber "1 NEW" when unread, relative time, subject 13px/500,
                type mono 9px uppercase. Thread from getTicketThread(): platform replies use the
                brand-tinted card (border color-mix(brand 30%, #22262e), bg color-mix(brand 7%, #14181e)),
                staff messages the plain #171b21 card; reply row reuses the chat input; resolved shows
                "RESOLVED — REPLYING REOPENS THE TICKET"; closed/declined block replies with the
                existing server copy. See README §3d/§3e for exact measurements. */}
          </section>
        </>
      )}
    </div>
  );
}
