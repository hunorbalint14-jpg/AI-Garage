"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveLabourCostRate } from "./costing-actions";

export function CostingSection({
  initialRate,
  canManage,
}: {
  initialRate: number | null;
  canManage: boolean;
}) {
  const [rate, setRate] = useState(initialRate !== null ? String(initialRate) : "");
  const [pending, startTransition] = useTransition();
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await saveLabourCostRate(formData);
      if ("error" in result) setError(result.error);
      else setInfo("Labour cost rate saved.");
    });
  }

  return (
    <section className="rounded-lg border p-5 flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold">Costing</h2>
        <p className="text-sm text-muted-foreground mt-1">
          What an hour of technician time costs the business (wages + overheads ÷ productive hours). Powers
          labour cost and gross profit on jobs and reports — leave empty and those figures show as unknown
          rather than a guess. Sell prices are unaffected.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="labour-cost-rate" className="text-xs">Labour cost rate (£/hour)</Label>
          <Input
            id="labour-cost-rate"
            name="rate"
            type="number"
            step="0.5"
            min="0"
            max="1000"
            placeholder="e.g. 28"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            disabled={pending || !canManage}
            className="w-32"
          />
        </div>
        <Button type="submit" disabled={!canManage} loading={pending}>
          Save
        </Button>
      </form>

      {!canManage && <p className="text-xs text-muted-foreground">Only owners and admins can change this.</p>}
      {info && <p className="text-sm text-ws-green">{info}</p>}
      {error && <p className="text-sm text-ws-red">{error}</p>}
    </section>
  );
}
