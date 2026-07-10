"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { saveAccountSettings } from "./account-actions";

// Account-customer panel (#504 PR 2): flag + terms + credit limit +
// consolidated billing, with the live balance alongside.

function fmtGBP(n: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

export function AccountSection({
  customerId,
  initial,
  balance,
  canManage,
}: {
  customerId: string;
  initial: {
    accountCustomer: boolean;
    paymentTermsDays: number;
    creditLimit: number | null;
    consolidatedBilling: boolean;
  };
  balance: { openInvoiced: number; unbilledJobs: number; unbilledJobCount: number; total: number } | null;
  canManage: boolean;
}) {
  const [on, setOn] = useState(initial.accountCustomer);
  const [terms, setTerms] = useState(String(initial.paymentTermsDays));
  const [limit, setLimit] = useState(initial.creditLimit !== null ? String(initial.creditLimit) : "");
  const [consolidated, setConsolidated] = useState(initial.consolidatedBilling);
  const [pending, startTransition] = useTransition();
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const overLimit =
    on && balance && initial.creditLimit !== null && balance.total > initial.creditLimit;

  function handleSave() {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const res = await saveAccountSettings(customerId, {
        accountCustomer: on,
        paymentTermsDays: Number(terms || 30),
        creditLimit: limit.trim() === "" ? null : Number(limit),
        consolidatedBilling: consolidated,
      });
      if ("error" in res) setError(res.error);
      else setInfo("Account settings saved.");
    });
  }

  return (
    <section className="rounded-lg border p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Trade account</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Account customers get payment terms, an optional credit limit, and (optionally) one
            consolidated invoice at month end instead of per-job invoices.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOn((v) => !v)}
          disabled={!canManage || pending}
          aria-label={on ? "Disable account billing" : "Enable account billing"}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent transition-colors disabled:cursor-not-allowed ${on ? "bg-primary" : "bg-muted"}`}
        >
          <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-ws-card shadow-sm transition-transform ${on ? "translate-x-4" : "translate-x-0"}`} />
        </button>
      </div>

      {on && balance && (
        <div className={`rounded-md border px-3 py-2 text-sm ${overLimit ? "border-amber-500/40 bg-amber-500/10" : ""}`}>
          <span className="font-semibold tabular-nums">{fmtGBP(balance.total)}</span>{" "}
          <span className="text-muted-foreground">
            on account · {fmtGBP(balance.openInvoiced)} invoiced
            {balance.unbilledJobCount > 0 &&
              ` + ${fmtGBP(balance.unbilledJobs)} across ${balance.unbilledJobCount} unbilled job${balance.unbilledJobCount === 1 ? "" : "s"}`}
          </span>
          {overLimit && initial.creditLimit !== null && (
            <span className="ml-1 font-semibold text-ws-amber">— over the {fmtGBP(initial.creditLimit)} limit</span>
          )}
        </div>
      )}

      {on && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Payment terms (days)
            <input
              type="number"
              min={0}
              max={120}
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              disabled={!canManage || pending}
              className="w-24 rounded-md border bg-transparent px-2 py-1.5 text-sm text-foreground"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Credit limit (£, empty = none)
            <input
              type="number"
              min={0}
              step="50"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              disabled={!canManage || pending}
              placeholder="no limit"
              className="w-32 rounded-md border bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground"
            />
          </label>
          <label className="mb-1.5 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={consolidated}
              onChange={(e) => setConsolidated(e.target.checked)}
              disabled={!canManage || pending}
              className="h-4 w-4 accent-current"
            />
            Consolidated monthly invoice
          </label>
        </div>
      )}

      {canManage && (
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={handleSave} loading={pending}>
            Save
          </Button>
          {info && <p className="text-sm text-ws-green">{info}</p>}
          {error && <p className="text-sm text-ws-red">{error}</p>}
        </div>
      )}
      {!canManage && <p className="text-xs text-muted-foreground">Only staff with invoice access can change account settings.</p>}
    </section>
  );
}
