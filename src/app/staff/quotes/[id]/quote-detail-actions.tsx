"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, X, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cancelStandaloneQuote, sendQuoteDraft } from "../actions";

export function QuoteDetailActions({ quoteId, status }: { quoteId: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [customerUrl, setCustomerUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  const canSend = status === "draft";
  const canCancel = status === "pending" || status === "draft";

  if (!canSend && !canCancel && status !== "approved") {
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
        {canCancel && (
          <Button variant="outline" onClick={handleCancel} disabled={pending}>
            <X className="mr-2 h-4 w-4" /> Cancel quote
          </Button>
        )}
      </div>
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
