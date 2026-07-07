"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createInvoiceFromJob } from "../invoices/actions";

// One-click INVOICE → on unbilled job cards (UX review F8): runs the existing
// create-invoice-from-job action and lands on the draft invoice.
export function InvoiceButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  function run() {
    setError(false);
    startTransition(async () => {
      const result = await createInvoiceFromJob(jobId);
      if ("error" in result) setError(true);
      else router.push(`/staff/invoices/${result.invoiceId}`);
    });
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={pending}
      className={`relative z-10 rounded-[2px] border px-2 py-[3px] font-mono text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors disabled:opacity-60 ${
        error
          ? "border-ws-red-border bg-ws-red-bg text-ws-red"
          : "border-ws-green-border bg-ws-green-bg text-ws-green hover:bg-[#1a4029]"
      }`}
    >
      {pending ? "Creating…" : error ? "Failed — retry" : "Invoice →"}
    </button>
  );
}
