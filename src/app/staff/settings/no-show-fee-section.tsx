"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveNoShowFee } from "./no-show-fee-actions";

export function NoShowFeeSection({
  initialFeePence,
  canManage,
  stripeActive,
}: {
  initialFeePence: number;
  canManage: boolean;
  stripeActive: boolean;
}) {
  const [fee, setFee] = useState(String(initialFeePence / 100));
  const [pending, startTransition] = useTransition();
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await saveNoShowFee(formData);
      if ("error" in result) setError(result.error);
      else
        setInfo(
          result.feePence === 0
            ? "No-show protection disabled."
            : `No-show fee set to £${(result.feePence / 100).toFixed(2)}.`,
        );
    });
  }

  return (
    <section className="rounded-lg border p-5 flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold">No-show protection</h2>
        <p className="text-sm text-muted-foreground mt-1">
          When set, customers booking unpaid appointments are asked to save a card (nothing is
          charged at booking). If they don&apos;t turn up, you can charge this fee from the booking
          page — always your call, never automatic. Set to <strong>0</strong> to disable.
        </p>
      </div>

      {!stripeActive && (
        <p className="text-xs text-amber-700">
          Connect Stripe above first — card-on-file won&rsquo;t work without an active
          card-payments account.
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="no-show-fee" className="text-xs">No-show fee (£)</Label>
          <Input
            id="no-show-fee"
            name="fee"
            type="number"
            step="0.50"
            min="0"
            max="100"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            disabled={pending || !canManage}
            className="w-32"
          />
        </div>
        <Button type="submit" disabled={!canManage} loading={pending}>
          Save
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
