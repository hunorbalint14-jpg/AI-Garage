"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { saveAccountSettings } from "./account-actions";
import { raiseConsolidatedInvoice } from "./consolidated-actions";
import { recordPayment, emailStatement } from "./payment-actions";

// Default billing period: the previous calendar month.
function lastMonthValue(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthRange(value: string): { fromIso: string; toIso: string } {
  const [y, m] = value.split("-").map(Number);
  return {
    fromIso: new Date(Date.UTC(y, m - 1, 1)).toISOString(),
    toIso: new Date(Date.UTC(y, m, 1)).toISOString(),
  };
}

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
  const [billMonth, setBillMonth] = useState(lastMonthValue);
  const [raising, setRaising] = useState(false);
  const [raised, setRaised] = useState<{ invoiceId: string; invoiceNumber: string; jobCount: number; total: number } | null>(null);

  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("bank_transfer");
  const [payRef, setPayRef] = useState("");
  const [paying, setPaying] = useState(false);
  const [emailing, setEmailing] = useState(false);

  async function handleRecordPayment() {
    setError(null);
    setInfo(null);
    setPaying(true);
    const res = await recordPayment(customerId, {
      amount: Number(payAmount),
      method: payMethod,
      reference: payRef.trim() || null,
      receivedAt: null,
    });
    setPaying(false);
    if ("error" in res) return setError(res.error);
    setInfo(
      `Payment recorded — allocated to ${res.allocatedTo} invoice${res.allocatedTo === 1 ? "" : "s"}` +
        (res.unallocated > 0 ? `, ${fmtGBP(res.unallocated)} held as credit.` : "."),
    );
    setPayAmount("");
    setPayRef("");
  }

  async function handleEmailStatement() {
    setError(null);
    setInfo(null);
    setEmailing(true);
    const now = new Date();
    const res = await emailStatement(customerId, {
      fromIso: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
      toIso: now.toISOString(),
    });
    setEmailing(false);
    if ("error" in res) return setError(res.error);
    setInfo("Statement emailed.");
  }

  async function handleRaise() {
    setError(null);
    setInfo(null);
    setRaised(null);
    setRaising(true);
    const res = await raiseConsolidatedInvoice(customerId, monthRange(billMonth));
    setRaising(false);
    if ("error" in res) return setError(res.error);
    setRaised(res);
  }

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

      {on && canManage && (
        <div className="flex flex-wrap items-end gap-3 border-t pt-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Record payment (£)
            <input
              type="number"
              min={0.01}
              step="0.01"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              disabled={paying}
              placeholder="0.00"
              className="w-28 rounded-md border bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Method
            <select
              value={payMethod}
              onChange={(e) => setPayMethod(e.target.value)}
              disabled={paying}
              className="rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
            >
              <option value="bank_transfer">Bank transfer</option>
              <option value="card">Card</option>
              <option value="cash">Cash</option>
              <option value="cheque">Cheque</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Reference
            <input
              value={payRef}
              onChange={(e) => setPayRef(e.target.value)}
              disabled={paying}
              placeholder="e.g. BACS 1042"
              className="w-32 rounded-md border bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground"
            />
          </label>
          <Button size="sm" variant="outline" onClick={handleRecordPayment} loading={paying} disabled={!payAmount}>
            Record payment
          </Button>
          <span className="mb-1.5 flex items-center gap-3 text-sm">
            <Link href={`/staff/customers/${customerId}/statement`} className="underline underline-offset-2 text-muted-foreground">
              Statement →
            </Link>
            <Button size="sm" variant="ghost" onClick={handleEmailStatement} loading={emailing}>
              Email statement
            </Button>
          </span>
        </div>
      )}

      {on && initial.consolidatedBilling && canManage && (
        <div className="flex flex-wrap items-end gap-3 border-t pt-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Billing month
            <input
              type="month"
              value={billMonth}
              onChange={(e) => setBillMonth(e.target.value)}
              disabled={raising}
              className="rounded-md border bg-transparent px-2 py-1.5 text-sm text-foreground"
            />
          </label>
          <Button size="sm" variant="outline" onClick={handleRaise} loading={raising}>
            Raise consolidated invoice
          </Button>
          {raised && (
            <p className="mb-1.5 text-sm text-ws-green">
              {raised.invoiceNumber} · {raised.jobCount} job{raised.jobCount === 1 ? "" : "s"} ·{" "}
              {fmtGBP(raised.total)} —{" "}
              <Link href={`/staff/invoices/${raised.invoiceId}`} className="underline underline-offset-2">
                open →
              </Link>
            </p>
          )}
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
