"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { saveAccountSettings } from "./account-actions";
import { raiseConsolidatedInvoice } from "./consolidated-actions";
import { recordPayment, emailStatement } from "./payment-actions";
import { MONO_LABEL_CLASS } from "../customers-ui";

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
// consolidated billing, with the live balance alongside. The command-deck
// redesign leads with the balance-against-limit read the owner actually scans
// for; the settings and the month-end run stay one disclosure away rather than
// filling the rail with inputs.

function fmtGBP(n: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

const FIELD_CLASS =
  "rounded-[8px] border border-ws-border bg-ws-page px-2 py-1.5 text-[13px] text-ws-text outline-none transition-colors placeholder:text-ws-text-3 focus:border-ws-text-3 disabled:opacity-50";

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
  // Bar only means something against a limit; unlimited accounts get no bar.
  const usedPct =
    balance && initial.creditLimit && initial.creditLimit > 0
      ? Math.min(100, (balance.total / initial.creditLimit) * 100)
      : null;

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
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className={MONO_LABEL_CLASS}>{"// TRADE ACCOUNT"}</h2>
        <button
          type="button"
          onClick={() => setOn((v) => !v)}
          disabled={!canManage || pending}
          aria-label={on ? "Disable account billing" : "Enable account billing"}
          aria-pressed={on}
          className={`relative inline-flex h-[18px] w-8 flex-none items-center rounded-full border-2 border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            on ? "bg-ws-green" : "bg-ws-border"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-ws-page transition-transform ${
              on ? "translate-x-3.5" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {!on && (
        <p className="text-[13px] text-ws-text-2">
          Not a trade account. Enable to set payment terms, a credit limit and consolidated billing.
        </p>
      )}

      {on && balance && (
        <div>
          <p className="text-[18px] font-bold tabular-nums text-ws-text">
            {fmtGBP(balance.total)}{" "}
            <span className="text-[12px] font-normal text-ws-text-2">
              {initial.creditLimit !== null ? `of ${fmtGBP(initial.creditLimit)} limit` : "on account · no limit set"}
            </span>
          </p>
          {usedPct !== null && (
            <div className="my-2 h-1.5 overflow-hidden rounded-full bg-ws-border">
              <div
                className={`h-full rounded-full ${overLimit ? "bg-ws-red" : "bg-ws-amber"}`}
                style={{ width: `${usedPct}%` }}
              />
            </div>
          )}
          <p className="mt-1.5 text-[12px] text-ws-text-2">
            {initial.paymentTermsDays}-day terms
            {initial.consolidatedBilling ? " · consolidated monthly invoice" : " · invoiced per job"}
          </p>
          <p className="mt-1 text-[12px] text-ws-text-3">
            {fmtGBP(balance.openInvoiced)} invoiced
            {balance.unbilledJobCount > 0 &&
              ` + ${fmtGBP(balance.unbilledJobs)} across ${balance.unbilledJobCount} unbilled job${balance.unbilledJobCount === 1 ? "" : "s"}`}
          </p>
          {overLimit && initial.creditLimit !== null && (
            <p className="mt-1 text-[12px] font-semibold text-ws-amber">
              Over the {fmtGBP(initial.creditLimit)} limit.
            </p>
          )}
        </div>
      )}

      {on && canManage && (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="outline" onClick={handleRecordPayment} loading={paying} disabled={!payAmount}>
            Record payment
          </Button>
          <Link
            href={`/staff/customers/${customerId}/statement`}
            className="text-[12.5px] text-ws-text-2 underline underline-offset-2 hover:text-ws-text"
          >
            Statement →
          </Link>
          <Button size="sm" variant="ghost" onClick={handleEmailStatement} loading={emailing}>
            Email statement
          </Button>
        </div>
      )}

      {on && canManage && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[11px] text-ws-text-3">
            Payment (£)
            <input
              type="number"
              min={0.01}
              step="0.01"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              disabled={paying}
              placeholder="0.00"
              className={`${FIELD_CLASS} w-24`}
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-ws-text-3">
            Method
            <select
              value={payMethod}
              onChange={(e) => setPayMethod(e.target.value)}
              disabled={paying}
              className={FIELD_CLASS}
            >
              <option value="bank_transfer">Bank transfer</option>
              <option value="card">Card</option>
              <option value="cash">Cash</option>
              <option value="cheque">Cheque</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-ws-text-3">
            Reference
            <input
              value={payRef}
              onChange={(e) => setPayRef(e.target.value)}
              disabled={paying}
              placeholder="e.g. BACS 1042"
              className={`${FIELD_CLASS} w-28`}
            />
          </label>
        </div>
      )}

      {canManage && (
        <details className="rounded-[8px] border border-ws-border bg-ws-page px-3 py-2">
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.12em] text-ws-text-3">
            Account settings
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-[11px] text-ws-text-3">
                Payment terms (days)
                <input
                  type="number"
                  min={0}
                  max={120}
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                  disabled={pending}
                  className={`${FIELD_CLASS} w-24`}
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-ws-text-3">
                Credit limit (£, empty = none)
                <input
                  type="number"
                  min={0}
                  step="50"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  disabled={pending}
                  placeholder="no limit"
                  className={`${FIELD_CLASS} w-32`}
                />
              </label>
              <label className="mb-1.5 flex items-center gap-2 text-[13px] text-ws-text-2">
                <input
                  type="checkbox"
                  checked={consolidated}
                  onChange={(e) => setConsolidated(e.target.checked)}
                  disabled={pending}
                  className="h-4 w-4 accent-current"
                />
                Consolidated monthly invoice
              </label>
            </div>

            {initial.consolidatedBilling && (
              <div className="flex flex-wrap items-end gap-3 border-t border-ws-border pt-3">
                <label className="flex flex-col gap-1 text-[11px] text-ws-text-3">
                  Billing month
                  <input
                    type="month"
                    value={billMonth}
                    onChange={(e) => setBillMonth(e.target.value)}
                    disabled={raising}
                    className={FIELD_CLASS}
                  />
                </label>
                <Button size="sm" variant="outline" onClick={handleRaise} loading={raising}>
                  Raise consolidated invoice
                </Button>
                {raised && (
                  <p className="mb-1.5 text-[13px] text-ws-green">
                    {raised.invoiceNumber} · {raised.jobCount} job{raised.jobCount === 1 ? "" : "s"} ·{" "}
                    {fmtGBP(raised.total)} —{" "}
                    <Link href={`/staff/invoices/${raised.invoiceId}`} className="underline underline-offset-2">
                      open →
                    </Link>
                  </p>
                )}
              </div>
            )}

            <Button size="sm" onClick={handleSave} loading={pending} className="self-start">
              Save
            </Button>
          </div>
        </details>
      )}

      {info && <p className="animate-cd-fade-up text-[12px] text-ws-green">✓ {info}</p>}
      {error && <p className="text-[12px] text-ws-red">{error}</p>}
      {!canManage && (
        <p className="text-[11.5px] text-ws-text-3">Only staff with invoice access can change account settings.</p>
      )}
    </div>
  );
}
