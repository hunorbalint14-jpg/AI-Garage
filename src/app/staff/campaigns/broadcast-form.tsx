"use client";

import { useState, useTransition } from "react";
import { draftBroadcastPreview, sendBroadcast } from "./actions";
import { Button } from "@/components/ui/button";

const TEXTAREA_CLASS =
  "w-full rounded-md border border-black/20 dark:border-white/25 bg-transparent px-3 py-2 text-sm shadow-sm resize-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

type DoneStep = {
  type: "done";
  emailSent: number;
  smsSent: number;
  whatsappSent: number;
  emailFailed: number;
  smsFailed: number;
  whatsappFailed: number;
  skippedNoEmail: number;
  skippedNoPhone: number;
  skippedNoEmailConsent: number;
  skippedNoSmsConsent: number;
  failureSamples: { recipient: string; channel: string; reason: string }[];
};

type Step =
  | { type: "idle" }
  | { type: "drafting" }
  | { type: "preview"; emailCount: number; smsCount: number; whatsappCount: number }
  | { type: "sending" }
  | DoneStep
  | { type: "error"; message: string };

type Props = { hasCustomers: boolean };

export function BroadcastForm({ hasCustomers }: Props) {
  const [step, setStep] = useState<Step>({ type: "idle" });
  const [topic, setTopic] = useState("");
  const [channels, setChannels] = useState<Set<"email" | "sms" | "whatsapp">>(new Set(["email"]));
  const [subject, setSubject] = useState("");
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
      const result = await draftBroadcastPreview(topic.trim(), [...channels]);
      if ("error" in result) {
        setStep({ type: "error", message: result.error });
      } else {
        setSubject(result.subject);
        setEmailText(result.email);
        setSmsText(result.sms);
        setStep({ type: "preview", emailCount: result.emailCount, smsCount: result.smsCount, whatsappCount: result.whatsappCount });
      }
    });
  }

  function handleSend() {
    if (!subject.trim()) return;
    setStep({ type: "sending" });
    startTransition(async () => {
      const result = await sendBroadcast(
        subject,
        emailText || null,
        smsText || null,
        channels.has("whatsapp") ? (emailText || null) : null,
      );
      if ("error" in result) {
        setStep({ type: "error", message: result.error });
      } else {
        setStep({
          type: "done",
          emailSent: result.emailSent,
          smsSent: result.smsSent,
          whatsappSent: result.whatsappSent,
          emailFailed: result.emailFailed,
          smsFailed: result.smsFailed,
          whatsappFailed: result.whatsappFailed,
          skippedNoEmail: result.skippedNoEmail,
          skippedNoPhone: result.skippedNoPhone,
          skippedNoEmailConsent: result.skippedNoEmailConsent,
          skippedNoSmsConsent: result.skippedNoSmsConsent,
          failureSamples: result.failureSamples,
        });
      }
    });
  }

  function reset() {
    setStep({ type: "idle" });
    setTopic("");
    setChannels(new Set(["email"]));
    setSubject("");
    setEmailText("");
    setSmsText("");
  }

  const isPreview = step.type === "preview";
  const isDrafting = step.type === "drafting";
  const isSending = step.type === "sending";

  if (step.type === "done") {
    const {
      emailSent, smsSent, whatsappSent,
      emailFailed, smsFailed, whatsappFailed,
      skippedNoEmail, skippedNoPhone, skippedNoEmailConsent, skippedNoSmsConsent,
      failureSamples,
    } = step;
    const totalSent = emailSent + smsSent + whatsappSent;
    const totalFailed = emailFailed + smsFailed + whatsappFailed;
    const totalSkipped =
      skippedNoEmail + skippedNoPhone + skippedNoEmailConsent + skippedNoSmsConsent;

    const sentParts: string[] = [];
    if (emailSent > 0) sentParts.push(`${emailSent} email${emailSent !== 1 ? "s" : ""}`);
    if (smsSent > 0) sentParts.push(`${smsSent} SMS`);
    if (whatsappSent > 0) sentParts.push(`${whatsappSent} WhatsApp`);

    const skipReasons: string[] = [];
    if (skippedNoEmailConsent > 0)
      skipReasons.push(`${skippedNoEmailConsent} not opted in to email marketing`);
    if (skippedNoSmsConsent > 0)
      skipReasons.push(`${skippedNoSmsConsent} not opted in to SMS marketing`);
    if (skippedNoEmail > 0) skipReasons.push(`${skippedNoEmail} no email on file`);
    if (skippedNoPhone > 0) skipReasons.push(`${skippedNoPhone} no phone on file`);

    return (
      <div className="rounded-lg border p-6 flex flex-col gap-4">
        {totalSent > 0 ? (
          <p className="text-green-700 font-medium">
            Campaign sent — {sentParts.join(" + ")} delivered to provider.
          </p>
        ) : (
          <p className="text-amber-600 font-medium">
            Campaign processed — 0 messages sent.
          </p>
        )}

        {totalFailed > 0 && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm">
            <p className="font-medium text-red-700">
              {totalFailed} failed at send time.
            </p>
            {failureSamples.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-red-700/90 list-disc pl-5">
                {failureSamples.map((f, i) => (
                  <li key={i}>
                    <span className="font-mono">{f.recipient}</span>{" "}
                    <span className="uppercase">({f.channel})</span> — {f.reason}
                  </li>
                ))}
                {totalFailed > failureSamples.length && (
                  <li className="list-none italic">
                    …and {totalFailed - failureSamples.length} more (see Campaign history below).
                  </li>
                )}
              </ul>
            )}
          </div>
        )}

        {totalSkipped > 0 && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <p className="font-medium">
              {totalSkipped} customer{totalSkipped !== 1 ? "s" : ""} skipped:
            </p>
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground list-disc pl-5">
              {skipReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              Marketing consent is collected per customer — update consent flags on the customer record to include them next time.
            </p>
          </div>
        )}

        <Button type="button" size="sm" variant="outline" onClick={reset}>
          Send another campaign
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-6 flex flex-col gap-4">
      {/* Step 1 — compose */}
      {(step.type === "idle" || step.type === "error" || isDrafting) && (
        <>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">What do you want to communicate?</label>
            <textarea
              className={TEXTAREA_CLASS + " min-h-[80px]"}
              placeholder="e.g. '15% discount on MOT bookings this month' or 'We've moved to a new location'"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              disabled={isDrafting}
            />
          </div>

          <div className="flex items-center gap-4 text-sm">
            <span className="font-medium">Channels:</span>
            {(["email", "sms", "whatsapp"] as const).map((ch) => (
              <label key={ch} className="flex items-center gap-2 cursor-pointer select-none capitalize">
                <input
                  type="checkbox"
                  checked={channels.has(ch)}
                  onChange={() => toggleChannel(ch)}
                  disabled={isDrafting}
                />
                {ch === "sms" ? "SMS" : ch === "whatsapp" ? "WhatsApp" : "Email"}
              </label>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <Button
              type="button"
              disabled={!topic.trim() || channels.size === 0 || isDrafting || !hasCustomers}
              onClick={handleDraft}
            >
              {isDrafting ? "Drafting…" : "Draft with AI"}
            </Button>
            {!hasCustomers && (
              <span className="text-sm text-muted-foreground">No customers at this location yet.</span>
            )}
            {step.type === "error" && (
              <span className="text-sm text-red-600">{step.message}</span>
            )}
          </div>
        </>
      )}

      {/* Step 2 — preview & edit */}
      {isPreview && (
        <>
          <div className="text-sm text-muted-foreground rounded-md bg-muted/40 px-3 py-2">
            Will send to{" "}
            {[
              step.emailCount > 0 && `${step.emailCount} by email`,
              step.smsCount > 0 && `${step.smsCount} by SMS`,
              step.whatsappCount > 0 && `${step.whatsappCount} by WhatsApp`,
            ].filter(Boolean).join(", ")}.
            Review and edit before sending.
          </div>

          {channels.has("email") && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Email subject
              </label>
              <input
                type="text"
                className={TEXTAREA_CLASS + " py-2"}
                value={subject}
                maxLength={120}
                onChange={(e) => setSubject(e.target.value)}
                disabled={isSending}
                placeholder="Subject line your customers will see"
              />
              <p className="text-xs text-muted-foreground">
                {subject.length}/120 — appears in the inbox preview.
              </p>
            </div>
          )}

          {emailText && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Email body</label>
              <textarea
                className={TEXTAREA_CLASS + " min-h-[160px]"}
                value={emailText}
                onChange={(e) => setEmailText(e.target.value)}
                disabled={isSending}
              />
            </div>
          )}

          {smsText && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
              disabled={isSending || (channels.has("email") && !subject.trim())}
              onClick={handleSend}
            >
              {isSending ? "Sending…" : `Send campaign`}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isSending}
              onClick={reset}
            >
              Back
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
