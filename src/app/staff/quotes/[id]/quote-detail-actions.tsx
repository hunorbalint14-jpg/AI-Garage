"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Send, X, Copy, PenLine, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cancelStandaloneQuote, sendQuoteDraft, sendManualReminder, type QuoteNotifyChannel } from "../actions";

export type ReminderProps = {
  hasEmail: boolean;
  hasPhone: boolean;
  // Channels the quote originally went out on — pre-ticked in the picker.
  sentChannels: string[];
  // False for quotes sent before the reminder feature stored the link.
  linkAvailable: boolean;
};

const CHANNEL_LABELS: { key: QuoteNotifyChannel; label: string; needs: "email" | "phone" }[] = [
  { key: "email", label: "Email", needs: "email" },
  { key: "sms", label: "SMS", needs: "phone" },
  { key: "whatsapp", label: "WhatsApp", needs: "phone" },
];

export function QuoteDetailActions({
  quoteId,
  status,
  reminder,
}: {
  quoteId: string;
  status: string;
  reminder?: ReminderProps;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [customerUrl, setCustomerUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderChannels, setReminderChannels] = useState<Record<QuoteNotifyChannel, boolean>>(() => ({
    email: !!reminder?.hasEmail && (reminder.sentChannels.length === 0 || reminder.sentChannels.includes("email")),
    sms: !!reminder?.hasPhone && (reminder?.sentChannels.length === 0 || !!reminder?.sentChannels.includes("sms")),
    whatsapp: !!reminder?.hasPhone && !!reminder?.sentChannels.includes("whatsapp"),
  }));

  function handleSend() {
    if (!confirm("Send this quote to the customer now? The token can only be retrieved once.")) return;
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const result = await sendQuoteDraft(quoteId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setInfo(`Sent via ${result.channels.join(" + ")}.`);
      setCustomerUrl(result.customerUrl);
      router.refresh();
    });
  }

  function handleCancel() {
    if (!confirm("Cancel this quote? The customer link will stop working.")) return;
    setError(null);
    startTransition(async () => {
      const result = await cancelStandaloneQuote(quoteId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function copyLink() {
    if (!customerUrl) return;
    navigator.clipboard.writeText(customerUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleReminderSend() {
    setError(null);
    setInfo(null);
    const selected = (Object.keys(reminderChannels) as QuoteNotifyChannel[]).filter((c) => reminderChannels[c]);
    if (selected.length === 0) {
      setError("Select at least one channel.");
      return;
    }
    startTransition(async () => {
      const result = await sendManualReminder({ quoteId, channels: selected });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setInfo(`Reminder sent via ${result.channels.join(" + ")}.`);
      setReminderOpen(false);
      router.refresh();
    });
  }

  const canSend = status === "draft";
  const canCancel = status === "pending" || status === "draft";
  const canRevise = status === "pending" || status === "expired";
  const canRemind = status === "pending" && !!reminder;

  if (!canSend && !canCancel && !canRevise && status !== "approved") {
    return null;
  }

  return (
    <section className="rounded-lg border p-4 flex flex-col gap-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Actions</h2>
      <div className="flex flex-wrap gap-2">
        {canSend && (
          <Button onClick={handleSend} disabled={pending}>
            <Send className="mr-2 h-4 w-4" /> Send to customer
          </Button>
        )}
        {canRevise && (
          <Button
            variant="outline"
            disabled={pending}
            nativeButton={false}
            render={
              <Link href={`/staff/quotes/${quoteId}/revise`}>
                <PenLine className="mr-2 h-4 w-4" /> Revise &amp; re-send
              </Link>
            }
          />
        )}
        {canRemind && (
          <Button
            variant="outline"
            onClick={() => setReminderOpen((v) => !v)}
            disabled={pending || !reminder.linkAvailable}
            title={reminder.linkAvailable ? undefined : "Sent before reminders existed — revise & re-send first"}
          >
            <BellRing className="mr-2 h-4 w-4" /> Send reminder
          </Button>
        )}
        {canCancel && (
          <Button variant="outline" onClick={handleCancel} disabled={pending}>
            <X className="mr-2 h-4 w-4" /> Cancel quote
          </Button>
        )}
      </div>
      {canRemind && reminderOpen && (
        <div className="rounded-md border bg-muted/20 p-3 flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            Nudge the customer about this quote — the original link keeps working.
          </p>
          <div className="flex flex-wrap gap-4 text-sm">
            {CHANNEL_LABELS.map(({ key, label, needs }) => {
              const available = needs === "email" ? reminder.hasEmail : reminder.hasPhone;
              return (
                <label key={key} className={`flex items-center gap-2 ${available ? "" : "opacity-50"}`}>
                  <input
                    type="checkbox"
                    checked={reminderChannels[key]}
                    disabled={pending || !available}
                    onChange={(e) => setReminderChannels((c) => ({ ...c, [key]: e.target.checked }))}
                  />
                  {label}
                  {!available && (needs === "email" ? " (no address)" : " (no phone)")}
                </label>
              );
            })}
          </div>
          <div>
            <Button size="sm" onClick={handleReminderSend} loading={pending}>
              <BellRing className="mr-2 h-3.5 w-3.5" /> Send now
            </Button>
          </div>
        </div>
      )}
      {status === "approved" && (
        <p className="text-sm text-muted-foreground">
          Quote approved. Contact the customer to schedule the work — the line items are stored on this quote until you create a booking + job.
        </p>
      )}
      {customerUrl && (
        <div className="rounded-md border bg-muted/20 p-2 flex items-center gap-2">
          <span className="text-xs text-muted-foreground shrink-0">Customer link (save it — mint-once):</span>
          <input readOnly value={customerUrl} className="flex-1 bg-transparent text-xs font-mono outline-none" />
          <Button size="sm" variant="outline" onClick={copyLink}>
            <Copy className="h-3 w-3 mr-1" /> {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      )}
      {info && <p className="text-sm text-green-700">{info}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}
