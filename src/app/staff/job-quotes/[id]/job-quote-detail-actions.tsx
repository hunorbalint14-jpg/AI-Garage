"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, X, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cancelQuote, remindQuote } from "../../jobs/[id]/quote-actions";

export function JobQuoteDetailActions({ quoteId, status }: { quoteId: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [customerUrl, setCustomerUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function handleRemind() {
    if (!confirm("Send a reminder? This rotates the link — the previously-sent link will stop working.")) return;
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const result = await remindQuote(quoteId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setInfo(`Reminder sent via ${result.channels.join(" + ")}.`);
      setCustomerUrl(result.customerUrl);
      router.refresh();
    });
  }

  function handleCancel() {
    if (!confirm("Cancel this quote? The customer link will stop working.")) return;
    setError(null);
    startTransition(async () => {
      const result = await cancelQuote(quoteId);
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

  if (status !== "pending") return null;

  return (
    <section className="rounded-lg border p-4 flex flex-col gap-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Actions</h2>
      <div className="flex flex-wrap gap-2">
        <Button onClick={handleRemind} disabled={pending}>
          <Bell className="mr-2 h-4 w-4" /> Remind customer
        </Button>
        <Button variant="outline" onClick={handleCancel} disabled={pending}>
          <X className="mr-2 h-4 w-4" /> Cancel quote
        </Button>
      </div>
      {customerUrl && (
        <div className="rounded-md border bg-muted/20 p-2 flex items-center gap-2">
          <span className="text-xs text-muted-foreground shrink-0">New customer link (save it — mint-once):</span>
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
