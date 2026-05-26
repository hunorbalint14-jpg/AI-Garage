"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveQuoteValidityDays } from "./quote-validity-actions";

export function QuoteValiditySection({
  initialDays,
  canManage,
}: {
  initialDays: number;
  canManage: boolean;
}) {
  const [days, setDays] = useState(String(initialDays));
  const [pending, startTransition] = useTransition();
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await saveQuoteValidityDays(formData);
      if ("error" in result) setError(result.error);
      else setInfo(`Default validity set to ${result.days} days.`);
    });
  }

  return (
    <section className="rounded-lg border p-5 flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold">Quote validity</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Default time a new quote stays open for the customer to approve. UK standard is <strong>30 days</strong>; individual quotes can override at draft time.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="quote-validity-days" className="text-xs">Default valid days</Label>
          <Input
            id="quote-validity-days"
            name="days"
            type="number"
            min="1"
            max="365"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            disabled={pending || !canManage}
            className="w-32"
          />
        </div>
        <Button type="submit" disabled={pending || !canManage}>{pending ? "Saving…" : "Save"}</Button>
      </form>

      {!canManage && (
        <p className="text-xs text-muted-foreground">Only owners and admins can change this.</p>
      )}
      {info && <p className="text-sm text-green-700">{info}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}
