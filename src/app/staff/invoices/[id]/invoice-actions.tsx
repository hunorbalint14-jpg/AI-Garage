"use client";

import { useState, useTransition } from "react";
import { sendInvoice, markInvoicePaid, deleteInvoice, refundInvoice } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = {
  invoiceId: string;
  status: string;
  hasCustomerEmail: boolean;
  refundablePence: number;
};

const fmt = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

export function InvoiceActions({ invoiceId, status, hasCustomerEmail, refundablePence }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [refunding, setRefunding] = useState(false);
  const refundablePounds = refundablePence / 100;
  const [refundAmount, setRefundAmount] = useState(refundablePounds.toFixed(2));
  const [refundReason, setRefundReason] = useState("");

  function handleRefund() {
    const amount = parseFloat(refundAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a valid refund amount.");
      return;
    }
    if (!confirm(`Refund ${fmt(amount)}? This issues a Stripe refund (if paid online) and records a credit note.`)) return;
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await refundInvoice(invoiceId, { amountPence: Math.round(amount * 100), reason: refundReason.trim() || undefined });
      if ("error" in result) setError(result.error);
      else {
        setSuccess("Refund processed.");
        setRefunding(false);
      }
    });
  }

  function handle(fn: () => Promise<{ error: string } | { success: true }>, msg: string) {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await fn();
      if ("error" in result) setError(result.error);
      else setSuccess(msg);
    });
  }

  function handleDelete() {
    if (!confirm("Delete this invoice? The job will revert to complete status.")) return;
    setError(null);
    startTransition(async () => {
      await deleteInvoice(invoiceId);
    });
  }

  const isPaid = status === "paid";

  return (
    <div className="rounded-lg border p-4 flex flex-col gap-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Actions</h2>
      <div className="flex flex-wrap gap-2">
        {!isPaid && hasCustomerEmail && (
          <Button onClick={() => handle(() => sendInvoice(invoiceId), "Invoice sent.")} loading={pending}>
            Send to customer
          </Button>
        )}
        {!isPaid && (
          <Button
            variant="outline"
            onClick={() => handle(() => markInvoicePaid(invoiceId), "Marked as paid.")}
            disabled={pending}
          >
            Mark as paid
          </Button>
        )}
        {!isPaid && (
          <Button variant="destructive" onClick={handleDelete} disabled={pending}>
            Delete
          </Button>
        )}
        <Button variant="outline" onClick={() => window.open(`/api/invoice/${invoiceId}/print`, "_blank")} disabled={pending}>
          Print / Save PDF
        </Button>
        {refundablePence > 0 && !refunding && (
          <Button variant="outline" onClick={() => setRefunding(true)} disabled={pending}>
            Refund
          </Button>
        )}
      </div>

      {refunding && (
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <p className="text-sm font-medium">Refund (up to {fmt(refundablePounds)})</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="refund-amount" className="text-xs text-muted-foreground">Amount (£)</label>
              <Input id="refund-amount" type="number" step="0.01" min="0" max={refundablePounds} value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} className="w-32" disabled={pending} />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor="refund-reason" className="text-xs text-muted-foreground">Reason (optional)</label>
              <Input id="refund-reason" value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder="e.g. goodwill / overcharge" disabled={pending} />
            </div>
            <Button onClick={handleRefund} loading={pending}>Issue refund</Button>
            <Button variant="outline" onClick={() => setRefunding(false)} disabled={pending}>Cancel</Button>
          </div>
        </div>
      )}

      {success && <p className="text-sm text-green-700">{success}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!hasCustomerEmail && !isPaid && (
        <p className="text-xs text-muted-foreground">Customer has no email — cannot send electronically.</p>
      )}
    </div>
  );
}
