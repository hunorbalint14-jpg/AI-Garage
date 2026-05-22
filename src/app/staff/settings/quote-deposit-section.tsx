"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveQuoteDepositPct } from "./quote-deposit-actions";

export function QuoteDepositSection({
  initialPct,
  canManage,
  stripeActive,
}: {
  initialPct: number;
  canManage: boolean;
  stripeActive: boolean;
}) {
  const [pct, setPct] = useState(String(initialPct));
  const [pending, startTransition] = useTransition();
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await saveQuoteDepositPct(formData);
      if ("error" in result) setError(result.error);
      else setInfo(result.pct === 0 ? "Deposit-on-approval disabled." : `Deposit set to ${result.pct}%.`);
    });
  }

  return (
    <section className="rounded-lg border p-5 flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold">Mid-job quote deposit</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Take a card deposit when the customer approves a mid-job quote. Set to <strong>0</strong> to disable. The deposit is charged via your existing Stripe Connect account; items are applied to the job after the deposit clears.
        </p>
      </div>

      {!stripeActive && (
        <p className="text-xs text-amber-700">
          Connect Stripe above first — deposits won&rsquo;t work without an active card-payments account.
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="quote-deposit-pct" className="text-xs">Deposit (% of quote total)</Label>
          <Input
            id="quote-deposit-pct"
            name="pct"
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            disabled={pending || !canManage}
            className="w-32"
          />
        </div>
        <Button type="submit" disabled={pending || !canManage}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </form>

      {!canManage && (
        <p className="text-xs text-muted-foreground">Only owners and admins can change this.</p>
      )}
      {info && <p className="text-sm text-green-700">{info}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}
