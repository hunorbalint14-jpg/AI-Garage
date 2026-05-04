"use client";

import { useState, useTransition } from "react";
import { sendInvoice, markInvoicePaid, deleteInvoice } from "../actions";
import { Button } from "@/components/ui/button";

type Props = {
  invoiceId: string;
  status: string;
  hasCustomerEmail: boolean;
};

export function InvoiceActions({ invoiceId, status, hasCustomerEmail }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
          <Button onClick={() => handle(() => sendInvoice(invoiceId), "Invoice sent.")} disabled={pending}>
            {pending ? "Sending…" : "Send to customer"}
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
        <Button variant="outline" onClick={() => window.print()} disabled={pending}>
          Print / Save PDF
        </Button>
      </div>
      {success && <p className="text-sm text-green-700">{success}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!hasCustomerEmail && !isPaid && (
        <p className="text-xs text-muted-foreground">Customer has no email — cannot send electronically.</p>
      )}
    </div>
  );
}
