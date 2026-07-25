"use client";

import { useState, useTransition } from "react";
import { draftMessagePreview, sendDraftedMessage } from "../actions";
import { Button } from "@/components/ui/button";
import { AiAssistMenu } from "@/components/staff/ai-assist-menu";

type Props = {
  customerId: string;
  hasEmail: boolean;
  hasPhone: boolean;
  /** Pre-seed the AI topic (e.g. the low-score recovery draft from a pulse alert). Never auto-drafts. */
  initialTopic?: string | null;
};

const TEXTAREA_CLASS =
  "w-full rounded-md border border-black/20 dark:border-white/25 bg-transparent px-3 py-2 text-sm shadow-sm resize-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

const LABEL_CLASS =
  "font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ws-text-3";

export function DraftMessagePanel({ customerId, hasEmail, hasPhone, initialTopic }: Props) {
  const [topic, setTopic] = useState(initialTopic ?? "");
  const [topicOpen, setTopicOpen] = useState(Boolean(initialTopic?.trim()));
  const [channels, setChannels] = useState<Set<"email" | "sms" | "whatsapp">>(new Set());
  const [emailText, setEmailText] = useState("");
  const [smsText, setSmsText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [drafting, startDrafting] = useTransition();
  const [sending, startSending] = useTransition();

  function toggleChannel(ch: "email" | "sms" | "whatsapp") {
    setChannels((prev) => {
      const next = new Set(prev);
      next.has(ch) ? next.delete(ch) : next.add(ch);
      return next;
    });
  }

  function handleDraft() {
    if (!topic.trim() || channels.size === 0) return;
    setError(null);
    startDrafting(async () => {
      const result = await draftMessagePreview(customerId, topic.trim(), [...channels]);
      if ("error" in result) {
        setError(result.error);
      } else {
        if (result.email !== null) setEmailText(result.email);
        if (result.sms !== null) setSmsText(result.sms);
      }
    });
  }

  function handleSend() {
    setError(null);
    startSending(async () => {
      const result = await sendDraftedMessage(
        customerId,
        topic,
        channels.has("email") ? (emailText || null) : null,
        channels.has("sms") ? (smsText || null) : null,
        channels.has("whatsapp") ? (emailText || null) : null,
      );
      if ("error" in result) {
        setError(result.error);
      } else {
        setDone(result.summary);
      }
    });
  }

  function reset() {
    setTopic("");
    setTopicOpen(false);
    setChannels(new Set());
    setEmailText("");
    setSmsText("");
    setError(null);
    setDone(null);
  }

  const busy = drafting || sending;
  const showEmailField = channels.has("email") || channels.has("whatsapp");
  const showSmsField = channels.has("sms");
  const canSend =
    (showEmailField && emailText.trim() !== "") ||
    (showSmsField && smsText.trim() !== "");

  return (
    <section className="rounded-lg border p-4 flex flex-col gap-3">
      <h2 className={LABEL_CLASS}>Message customer</h2>

      {done !== null ? (
        <div className="flex items-center gap-3">
          <span className="text-sm text-ws-green">{done}</span>
          <Button type="button" size="sm" variant="outline" onClick={reset}>
            New message
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-4 text-sm">
            {hasEmail && (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={channels.has("email")}
                  onChange={() => toggleChannel("email")}
                  disabled={busy}
                />
                Email
              </label>
            )}
            {hasPhone && (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={channels.has("sms")}
                  onChange={() => toggleChannel("sms")}
                  disabled={busy}
                />
                SMS
              </label>
            )}
            {hasPhone && (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={channels.has("whatsapp")}
                  onChange={() => toggleChannel("whatsapp")}
                  disabled={busy}
                />
                WhatsApp
              </label>
            )}
            {!hasEmail && !hasPhone && (
              <span className="text-muted-foreground text-xs">
                No email or phone on file — add contact details to send messages.
              </span>
            )}
          </div>

          {showEmailField && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <label className={LABEL_CLASS}>
                  Email
                  {channels.has("whatsapp") && (
                    <span className="normal-case font-normal tracking-normal text-muted-foreground">
                      {" "}— also sent as the WhatsApp message
                    </span>
                  )}
                </label>
                <AiAssistMenu
                  channel="email"
                  getText={() => emailText}
                  onText={setEmailText}
                  onDraft={() => setTopicOpen(true)}
                  disabled={busy}
                />
              </div>
              <textarea
                className={TEXTAREA_CLASS + " min-h-[140px]"}
                placeholder="Write your message to the customer…"
                value={emailText}
                onChange={(e) => setEmailText(e.target.value)}
                disabled={busy}
              />
            </div>
          )}

          {showSmsField && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <label className={LABEL_CLASS}>
                  SMS <span className="normal-case font-normal">({smsText.length} chars)</span>
                </label>
                <AiAssistMenu
                  channel="sms"
                  getText={() => smsText}
                  onText={setSmsText}
                  onDraft={() => setTopicOpen(true)}
                  disabled={busy}
                />
              </div>
              <textarea
                className={TEXTAREA_CLASS + " min-h-[80px]"}
                placeholder="Write a short text message…"
                value={smsText}
                onChange={(e) => setSmsText(e.target.value)}
                disabled={busy}
              />
            </div>
          )}

          {/* Shared "write it for me" topic row — only ever opened by the staff member */}
          {topicOpen && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                className="h-8 flex-1 rounded-md border border-black/20 dark:border-white/25 bg-transparent px-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                placeholder="What should the message say?"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && topic.trim() && channels.size > 0 && !busy) handleDraft();
                }}
                disabled={busy}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!topic.trim() || channels.size === 0 || sending}
                loading={drafting}
                onClick={handleDraft}
              >
                Draft
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setTopicOpen(false)}
              >
                Cancel
              </Button>
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button
              type="button"
              size="sm"
              disabled={!canSend || drafting}
              loading={sending}
              onClick={handleSend}
            >
              Send
            </Button>
            {error && <span className="text-sm text-ws-red">{error}</span>}
          </div>
        </>
      )}
    </section>
  );
}
