"use client";

import { useState, useTransition } from "react";
import { draftBroadcastPreview, sendBroadcast } from "./actions";
import { Button } from "@/components/ui/button";
import { AiAssistMenu } from "@/components/staff/ai-assist-menu";

const TEXTAREA_CLASS =
  "w-full rounded-md border border-black/20 dark:border-white/25 bg-transparent px-3 py-2 text-sm shadow-sm resize-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

const LABEL_CLASS =
  "font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ws-text-3";

type Channel = "email" | "sms" | "whatsapp";

type SendReport = {
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

type Props = { hasCustomers: boolean };

export function BroadcastForm({ hasCustomers }: Props) {
  const [channels, setChannels] = useState<Set<Channel>>(new Set(["email"]));
  const [subject, setSubject] = useState("");
  const [emailText, setEmailText] = useState("");
  const [smsText, setSmsText] = useState("");
  // Recipient counts from the last AI draft — the only recipient info the client has.
  const [counts, setCounts] = useState<{ email: number; sms: number; whatsapp: number } | null>(null);
  const [topic, setTopic] = useState("");
  const [topicOpen, setTopicOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<SendReport | null>(null);
  const [drafting, startDrafting] = useTransition();
  const [sending, startSending] = useTransition();

  const busy = drafting || sending;
  const showEmailBody = channels.has("email") || channels.has("whatsapp");
  const showSms = channels.has("sms");
  // Email needs a subject AND a body; WhatsApp reuses the email body. Every
  // ticked channel must be complete before send — never silently skip one.
  const missing: string[] = [];
  if (channels.has("email") && !(subject.trim() && emailText.trim())) missing.push("email needs a subject and body");
  if (showSms && !smsText.trim()) missing.push("SMS needs a message");
  if (channels.has("whatsapp") && !emailText.trim()) missing.push("WhatsApp needs the email body text");
  const canSend = hasCustomers && channels.size > 0 && missing.length === 0;

  function toggleChannel(ch: Channel) {
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
      const result = await draftBroadcastPreview(topic.trim(), [...channels]);
      if ("error" in result) {
        setError(result.error);
      } else {
        setSubject(result.subject);
        setEmailText(result.email);
        setSmsText(result.sms);
        setCounts({ email: result.emailCount, sms: result.smsCount, whatsapp: result.whatsappCount });
      }
    });
  }

  function handleSend() {
    if (!canSend) return;
    setError(null);
    startSending(async () => {
      const whatsappBody = channels.has("whatsapp") ? emailText : null;
      const smsBody = channels.has("sms") ? smsText : null;
      // The action requires a subject even for SMS/WhatsApp-only sends (it labels
      // the outcome log) — fall back to the first line of the message going out.
      const subjectPayload =
        subject.trim() || ((whatsappBody ?? smsBody ?? "").trim().split("\n")[0] || "Campaign").slice(0, 120);
      const result = await sendBroadcast(
        subjectPayload,
        channels.has("email") ? emailText : null,
        smsBody,
        whatsappBody,
      );
      if ("error" in result) {
        setError(result.error);
      } else {
        setReport({
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
    setChannels(new Set(["email"]));
    setSubject("");
    setEmailText("");
    setSmsText("");
    setCounts(null);
    setTopic("");
    setTopicOpen(false);
    setError(null);
    setReport(null);
  }

  if (report !== null) {
    const {
      emailSent, smsSent, whatsappSent,
      emailFailed, smsFailed, whatsappFailed,
      skippedNoEmail, skippedNoPhone, skippedNoEmailConsent, skippedNoSmsConsent,
      failureSamples,
    } = report;
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
          <p className="text-ws-green font-medium">
            Campaign sent — {sentParts.join(" + ")} delivered to provider.
          </p>
        ) : (
          <p className="text-ws-amber font-medium">
            Campaign processed — 0 messages sent.
          </p>
        )}

        {totalFailed > 0 && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm">
            <p className="font-medium text-ws-red">
              {totalFailed} failed at send time.
            </p>
            {failureSamples.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-ws-red/90 list-disc pl-5">
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

  // "Will send to…" banner, filtered to the channels currently ticked so
  // unticking a channel after drafting doesn't leave a misleading count.
  const countParts = counts
    ? [
        channels.has("email") && counts.email > 0 && `${counts.email} by email`,
        channels.has("sms") && counts.sms > 0 && `${counts.sms} by SMS`,
        channels.has("whatsapp") && counts.whatsapp > 0 && `${counts.whatsapp} by WhatsApp`,
      ].filter((p): p is string => Boolean(p))
    : [];

  return (
    <div className="rounded-lg border p-6 flex flex-col gap-4">
      <div className="flex items-center gap-4 text-sm">
        <span className="font-medium">Channels:</span>
        {(["email", "sms", "whatsapp"] as const).map((ch) => (
          <label key={ch} className="flex items-center gap-2 cursor-pointer select-none capitalize">
            <input
              type="checkbox"
              checked={channels.has(ch)}
              onChange={() => toggleChannel(ch)}
              disabled={busy}
            />
            {ch === "sms" ? "SMS" : ch === "whatsapp" ? "WhatsApp" : "Email"}
          </label>
        ))}
      </div>

      {countParts.length > 0 && (
        <div className="text-sm text-muted-foreground rounded-md bg-muted/40 px-3 py-2">
          Will send to {countParts.join(", ")}. Review and edit before sending.
        </div>
      )}

      {channels.has("email") && (
        <div className="flex flex-col gap-1.5">
          <label className={LABEL_CLASS}>Email subject</label>
          <input
            type="text"
            className={TEXTAREA_CLASS + " py-2"}
            value={subject}
            maxLength={120}
            onChange={(e) => setSubject(e.target.value)}
            disabled={busy}
            placeholder="Subject line your customers will see"
          />
          <p className="text-xs text-muted-foreground">
            {subject.length}/120 — appears in the inbox preview.
          </p>
        </div>
      )}

      {showEmailBody && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <label className={LABEL_CLASS}>
              {channels.has("email") ? "Email body" : "WhatsApp message"}
              {channels.has("email") && channels.has("whatsapp") && (
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
            className={TEXTAREA_CLASS + " min-h-[160px]"}
            placeholder="Write your message to your customers…"
            value={emailText}
            onChange={(e) => setEmailText(e.target.value)}
            disabled={busy}
          />
        </div>
      )}

      {showSms && (
        <div className="flex flex-col gap-1.5">
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
            placeholder="What do you want to communicate? e.g. '15% discount on MOT bookings this month'"
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
            disabled={!topic.trim() || channels.size === 0 || sending || !hasCustomers}
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
          disabled={!canSend || drafting}
          loading={sending}
          onClick={handleSend}
        >
          Send campaign
        </Button>
        {!hasCustomers && (
          <span className="text-sm text-muted-foreground">No customers at this location yet.</span>
        )}
        {hasCustomers && !canSend && missing.length > 0 && (subject.trim() || emailText.trim() || smsText.trim()) && (
          <span className="text-sm text-muted-foreground">
            To send: {missing.join("; ")}.
          </span>
        )}
        {error && <span className="text-sm text-ws-red">{error}</span>}
      </div>
    </div>
  );
}
