"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Send, X, Copy, PenLine, BellRing, CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  cancelStandaloneQuote,
  sendQuoteDraft,
  sendManualReminder,
  convertQuoteToBooking,
  type QuoteNotifyChannel,
} from "../actions";
import { useConfirm } from "@/components/confirm-provider";

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

export type ConvertProps = {
  quoteType: "job" | "standalone";
  convertedBookingId: string | null;
  customerName: string | null;
  vehicleReg: string | null;
};

export function QuoteDetailActions({
  quoteId,
  status,
  reminder,
  convert,
}: {
  quoteId: string;
  status: string;
  reminder?: ReminderProps;
  convert?: ConvertProps;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  // "Charlie Customer — AB19 CDE", for confirmations that name the entity.
  const quoteRef = [convert?.customerName, convert?.vehicleReg].filter(Boolean).join(" — ");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [customerUrl, setCustomerUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [duration, setDuration] = useState("60");
  const [sendConfirmation, setSendConfirmation] = useState(true);
  const [outOfHours, setOutOfHours] = useState<string | null>(null);
  const [creditWarning, setCreditWarning] = useState<string | null>(null);
  const [reminderChannels, setReminderChannels] = useState<Record<QuoteNotifyChannel, boolean>>(() => ({
    email: !!reminder?.hasEmail && (reminder.sentChannels.length === 0 || reminder.sentChannels.includes("email")),
    sms: !!reminder?.hasPhone && (reminder?.sentChannels.length === 0 || !!reminder?.sentChannels.includes("sms")),
    whatsapp: !!reminder?.hasPhone && !!reminder?.sentChannels.includes("whatsapp"),
  }));

  async function handleSend() {
    const ok = await confirm({
      title: quoteRef ? `Send the quote for ${quoteRef}?` : "Send this quote to the customer now?",
      description:
        "The customer gets the link by their preferred channels straight away. The link token can only be retrieved once.",
      confirmLabel: "Send quote",
    });
    if (!ok) return;
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

  async function handleCancel() {
    const ok = await confirm({
      title: quoteRef ? `Cancel the quote for ${quoteRef}?` : "Cancel this quote?",
      description: "The customer link stops working immediately.",
      confirmLabel: "Cancel quote",
      cancelLabel: "Keep quote",
      destructive: true,
    });
    if (!ok) return;
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

  function handleConvert(confirmOutOfHours: boolean) {
    setError(null);
    setInfo(null);
    if (!scheduledAt) {
      setError("Pick a date and time for the booking.");
      return;
    }
    startTransition(async () => {
      const result = await convertQuoteToBooking({
        quoteId,
        scheduledAt,
        durationMinutes: parseInt(duration, 10) || 60,
        sendConfirmation,
        confirmOutOfHours,
        confirmCredit: !!creditWarning,
      });
      if ("error" in result) {
        setOutOfHours(null);
        setCreditWarning(null);
        setError(result.error);
        return;
      }
      if ("creditWarning" in result) {
        setCreditWarning(result.creditWarning);
        return;
      }
      if ("outOfHours" in result) {
        setOutOfHours(result.outOfHours);
        return;
      }
      router.push(`/staff/bookings/${result.bookingId}`);
    });
  }

  const canSend = status === "draft";
  const canCancel = status === "pending" || status === "draft";
  const canRevise = status === "pending" || status === "expired";
  const canRemind = status === "pending" && !!reminder;
  const canConvert =
    status === "approved" && convert?.quoteType === "standalone" && !convert.convertedBookingId;

  if (!canSend && !canCancel && !canRevise && status !== "approved") {
    return null;
  }

  return (
    <section className="rounded-lg border p-4 flex flex-col gap-3">
      <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ws-text-3">Actions</h2>
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
      {canConvert && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setConvertOpen((v) => !v)} disabled={pending}>
            <CalendarPlus className="mr-2 h-4 w-4" /> Convert to booking
          </Button>
        </div>
      )}
      {canConvert && convertOpen && (
        <div className="rounded-md border bg-muted/20 p-3 flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            Creates a booking for {convert.customerName ?? "the customer"}
            {convert.vehicleReg ? ` — ${convert.vehicleReg}` : ""}. The approved line items carry
            onto the job when work starts.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Date &amp; time
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => {
                  setScheduledAt(e.target.value);
                  setOutOfHours(null);
                }}
                disabled={pending}
                className="rounded-md border border-black/20 dark:border-white/25 bg-transparent px-3 py-2 text-sm text-foreground"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Duration
              <select
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                disabled={pending}
                className="rounded-md border border-black/20 dark:border-white/25 bg-transparent px-3 py-2 text-sm text-foreground"
              >
                <option value="30">30 min</option>
                <option value="45">45 min</option>
                <option value="60">1 hour</option>
                <option value="90">1.5 hours</option>
                <option value="120">2 hours</option>
                <option value="180">3 hours</option>
                <option value="240">4 hours</option>
              </select>
            </label>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                checked={sendConfirmation}
                disabled={pending}
                onChange={(e) => setSendConfirmation(e.target.checked)}
              />
              Send confirmation
            </label>
          </div>
          {creditWarning ? (
            <div className="rounded-md border border-ws-amber-border bg-ws-amber-bg p-2 text-sm text-ws-amber flex flex-col gap-2">
              <p>💳 {creditWarning}</p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => handleConvert(false)} loading={pending}>
                  Book anyway
                </Button>
                <Button size="sm" variant="outline" onClick={() => setCreditWarning(null)} disabled={pending}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : outOfHours ? (
            <div className="rounded-md border border-ws-amber-border bg-ws-amber-bg p-2 text-sm text-ws-amber flex flex-col gap-2">
              <p>{outOfHours}</p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => handleConvert(true)} loading={pending}>
                  Book anyway
                </Button>
                <Button size="sm" variant="outline" onClick={() => setOutOfHours(null)} disabled={pending}>
                  Change time
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <Button size="sm" onClick={() => handleConvert(false)} loading={pending}>
                <CalendarPlus className="mr-2 h-3.5 w-3.5" /> Create booking
              </Button>
            </div>
          )}
        </div>
      )}
      {status === "approved" && convert?.quoteType === "standalone" && convert.convertedBookingId && (
        <p className="text-sm text-muted-foreground">
          Quote approved and booked in.{" "}
          <Link href={`/staff/bookings/${convert.convertedBookingId}`} className="underline text-foreground">
            View booking →
          </Link>
        </p>
      )}
      {status === "approved" && convert?.quoteType !== "standalone" && (
        <p className="text-sm text-muted-foreground">
          Quote approved. The approved work continues on the linked job.
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
      {info && <p className="text-sm text-ws-green">{info}</p>}
      {error && <p className="text-sm text-ws-red">{error}</p>}
    </section>
  );
}
