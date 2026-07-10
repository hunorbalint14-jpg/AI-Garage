"use client";

import { useState } from "react";
import { Check, Copy, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-provider";
import { sendInspectionReport } from "./actions";
import type { CaptureItem } from "./inspection-capture";

// eVHC Phase 5 (#497): send the customer report. Email + SMS by default,
// WhatsApp opt-in. Sending flips a draft findings-quote to pending (the
// report page drives its approval), locks the check read-only, and shows
// the link once — resending mints a new link and kills the old one.

export function InspectionSendPanel({
  inspectionId,
  status,
  items,
  hasQuote,
  onSent,
}: {
  inspectionId: string;
  status: string;
  items: CaptureItem[];
  hasQuote: boolean;
  onSent: () => void;
}) {
  const confirm = useConfirm();
  const [whatsapp, setWhatsapp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentUrl, setSentUrl] = useState<string | null>(null);
  const [sentChannels, setSentChannels] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const sent = status === "sent";
  const unquotedAdvisories = items.filter(
    (i) => (i.rag === "amber" || i.rag === "red") && i.outcome === "none",
  ).length;

  async function handleSend() {
    if (sent) {
      const ok = await confirm({
        title: "Send a new report link?",
        description: "The customer gets a fresh link by email/SMS — the previously sent link stops working.",
        confirmLabel: "Resend report",
      });
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    const res = await sendInspectionReport(inspectionId, { whatsapp });
    setBusy(false);
    if ("error" in res) return setError(res.error);
    setSentUrl(res.url);
    setSentChannels(res.channels);
    onSent();
  }

  async function copyUrl() {
    if (!sentUrl) return;
    try {
      await navigator.clipboard.writeText(sentUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the URL is visible to select manually */
    }
  }

  return (
    <section className="rounded-lg border">
      <h2 className="border-b px-4 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ws-text-3">
        Customer report
      </h2>
      <div className="flex flex-col gap-3 px-4 py-3">
        {sentUrl ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-ws-green">
              Report sent{sentChannels.length > 0 ? ` via ${sentChannels.join(" + ")}` : ""}.
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/30 px-2 py-1.5 text-xs">{sentUrl}</code>
              <Button variant="outline" size="sm" onClick={copyUrl}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {sent
                ? "Report is with the customer. Resend to issue a fresh link (the old one stops working)."
                : hasQuote
                  ? "Sends the graded report with photos — the customer approves or declines each priced finding from the same page."
                  : "Sends the graded report with photos. No quote is attached yet — the customer sees the findings read-only."}
            </p>
            {!sent && unquotedAdvisories > 0 && hasQuote && (
              <p className="text-xs text-ws-amber">
                {unquotedAdvisories} advisory finding{unquotedAdvisories === 1 ? " isn&apos;t" : "s aren&apos;t"} on the quote —
                they&apos;ll show without a price.
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.checked)}
                  className="h-4 w-4 accent-current"
                />
                Also send by WhatsApp
              </label>
              <Button size="sm" onClick={handleSend} loading={busy}>
                <Send className="h-3.5 w-3.5" /> {sent ? "Resend report" : "Send report"}
              </Button>
            </div>
          </>
        )}
        {error && <p className="text-sm text-ws-red">{error}</p>}
      </div>
    </section>
  );
}
