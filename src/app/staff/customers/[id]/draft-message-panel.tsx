"use client";

import { useState, useTransition } from "react";
import { draftMessagePreview, sendDraftedMessage, type DraftMessagePreviewResult } from "../actions";
import { Button } from "@/components/ui/button";

type Props = {
  customerId: string;
  hasEmail: boolean;
  hasPhone: boolean;
};

type Step =
  | { type: "idle" }
  | { type: "drafting" }
  | { type: "preview"; email: string | null; sms: string | null }
  | { type: "sending" }
  | { type: "done"; summary: string }
  | { type: "error"; message: string };

const TEXTAREA_CLASS =
  "w-full rounded-md border border-black/20 dark:border-white/25 bg-transparent px-3 py-2 text-sm shadow-sm resize-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

export function DraftMessagePanel({ customerId, hasEmail, hasPhone }: Props) {
  const [step, setStep] = useState<Step>({ type: "idle" });
  const [topic, setTopic] = useState("");
  const [channels, setChannels] = useState<Set<"email" | "sms" | "whatsapp">>(new Set());
  const [emailText, setEmailText] = useState("");
  const [smsText, setSmsText] = useState("");
  const [pending, startTransition] = useTransition();

  function toggleChannel(ch: "email" | "sms" | "whatsapp") {
    setChannels((prev) => {
      const next = new Set(prev);
      next.has(ch) ? next.delete(ch) : next.add(ch);
      return next;
    });
  }

  function handleDraft() {
    if (!topic.trim() || channels.size === 0) return;
    setStep({ type: "drafting" });
    startTransition(async () => {
      const result = await draftMessagePreview(customerId, topic.trim(), [...channels]);
      if ("error" in result) {
        setStep({ type: "error", message: result.error });
      } else {
        setEmailText(result.email ?? "");
        setSmsText(result.sms ?? "");
        setStep({ type: "preview", email: result.email, sms: result.sms });
      }
    });
  }

  function handleSend() {
    setStep({ type: "sending" });
    startTransition(async () => {
      const result = await sendDraftedMessage(
        customerId,
        topic,
        channels.has("email") ? (emailText || null) : null,
        channels.has("sms") ? (smsText || null) : null,
        channels.has("whatsapp") ? (emailText || null) : null,
      );
      if ("error" in result) {
        setStep({ type: "error", message: result.error });
      } else {
        setStep({ type: "done", summary: result.summary });
      }
    });
  }

  function reset() {
    setStep({ type: "idle" });
    setTopic("");
    setChannels(new Set());
    setEmailText("");
    setSmsText("");
  }

  const isIdle = step.type === "idle" || step.type === "error";
  const isPreview = step.type === "preview";
  const isDrafting = step.type === "drafting";
  const isSending = step.type === "sending";

  return (
    <section className="rounded-lg border p-4 flex flex-col gap-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
        AI Message
      </h2>

      {/* Step 1 — compose */}
      {(isIdle || isDrafting) && (
        <>
          <textarea
            className={TEXTAREA_CLASS + " min-h-[80px]"}
            placeholder="What do you want to communicate? e.g. 'Follow up on the brake job quote from last week'"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            disabled={isDrafting}
          />
          <div className="flex items-center gap-4 text-sm">
            {hasEmail && (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={channels.has("email")}
                  onChange={() => toggleChannel("email")}
                  disabled={isDrafting}
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
                  disabled={isDrafting}
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
                  disabled={isDrafting}
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
          <div className="flex items-center gap-3">
            <Button
              type="button"
              size="sm"
              disabled={!topic.trim() || channels.size === 0 || isDrafting}
              onClick={handleDraft}
            >
              {isDrafting ? "Drafting…" : "Draft with AI"}
            </Button>
            {step.type === "error" && (
              <span className="text-sm text-red-600">{step.message}</span>
            )}
          </div>
        </>
      )}

      {/* Step 2 — preview & edit */}
      {isPreview && (
        <>
          <p className="text-xs text-muted-foreground">
            Review and edit before sending.
          </p>
          {step.email !== null && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Email</label>
              <textarea
                className={TEXTAREA_CLASS + " min-h-[140px]"}
                value={emailText}
                onChange={(e) => setEmailText(e.target.value)}
                disabled={isSending}
              />
            </div>
          )}
          {step.sms !== null && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                SMS <span className="normal-case font-normal">({smsText.length} chars)</span>
              </label>
              <textarea
                className={TEXTAREA_CLASS + " min-h-[80px]"}
                value={smsText}
                onChange={(e) => setSmsText(e.target.value)}
                disabled={isSending}
              />
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button
              type="button"
              size="sm"
              disabled={isSending}
              onClick={handleSend}
            >
              {isSending ? "Sending…" : "Send"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isSending}
              onClick={reset}
            >
              Back
            </Button>
          </div>
        </>
      )}

      {/* Done */}
      {step.type === "done" && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-green-700">{step.summary}</span>
          <Button type="button" size="sm" variant="outline" onClick={reset}>
            New message
          </Button>
        </div>
      )}
    </section>
  );
}
