"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runMonthEnd } from "../customers/[id]/consolidated-actions";

// Org-wide month-end run (#504 PR 3): one consolidated invoice per account
// with billable jobs at the active branch, for the picked month.

function lastMonthValue(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function fmtGBP(n: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

export function RunMonthEnd() {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(lastMonthValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ customerName: string; invoiceNumber: string; jobCount: number; total: number }[] | null>(null);

  async function handleRun() {
    setBusy(true);
    setError(null);
    setResult(null);
    const [y, m] = month.split("-").map(Number);
    const res = await runMonthEnd({
      fromIso: new Date(Date.UTC(y, m - 1, 1)).toISOString(),
      toIso: new Date(Date.UTC(y, m, 1)).toISOString(),
    });
    setBusy(false);
    if ("error" in res) return setError(res.error);
    setResult(res.raised);
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <CalendarClock className="h-3.5 w-3.5" /> Run month end
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
      <input
        type="month"
        value={month}
        onChange={(e) => setMonth(e.target.value)}
        disabled={busy}
        className="rounded-md border bg-transparent px-2 py-1 text-sm"
      />
      <Button size="sm" onClick={handleRun} loading={busy}>
        Raise consolidated invoices
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
        ✕
      </Button>
      {error && <p className="w-full text-sm text-ws-red">{error}</p>}
      {result && (
        <p className="w-full text-sm text-muted-foreground">
          {result.length === 0
            ? "No consolidated accounts had unbilled jobs in that month."
            : result.map((r) => `${r.customerName}: ${r.invoiceNumber} (${r.jobCount} job${r.jobCount === 1 ? "" : "s"}, ${fmtGBP(r.total)})`).join(" · ")}
        </p>
      )}
    </div>
  );
}
