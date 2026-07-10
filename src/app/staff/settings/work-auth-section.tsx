"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveWorkAuthSettings } from "./work-auth-actions";

export function WorkAuthSection({
  initialTerms,
  initialThresholdPct,
  canManage,
}: {
  initialTerms: string | null;
  initialThresholdPct: number;
  canManage: boolean;
}) {
  const [terms, setTerms] = useState(initialTerms ?? "");
  const [pct, setPct] = useState(String(initialThresholdPct));
  const [pending, startTransition] = useTransition();
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await saveWorkAuthSettings(formData);
      if ("error" in result) setError(result.error);
      else setInfo("Work-authorisation settings saved.");
    });
  }

  return (
    <section className="rounded-lg border p-5 flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold">Work authorisation</h2>
        <p className="text-sm text-muted-foreground mt-1">
          The terms shown when a customer authorises work (counter signature, quote approval, or a
          re-authorisation link), and how far a job may drift past the authorised total before staff are
          warned to ask again. Every authorisation stores its own copy of the terms — editing them here never
          changes past records.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="work-auth-terms" className="text-xs">Authorisation terms</Label>
          <textarea
            id="work-auth-terms"
            name="terms"
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            rows={5}
            maxLength={10_000}
            disabled={pending || !canManage}
            placeholder="e.g. Work is carried out under our standard repair terms. Estimates may vary for unforeseen items; we will contact you before exceeding the authorised amount…"
            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="work-auth-threshold" className="text-xs">Variation tolerance (%)</Label>
            <Input
              id="work-auth-threshold"
              name="thresholdPct"
              type="number"
              step="0.5"
              min="0"
              max="100"
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              disabled={pending || !canManage}
              className="w-32"
            />
          </div>
          <Button type="submit" disabled={!canManage} loading={pending}>
            Save
          </Button>
        </div>
      </form>

      {!canManage && <p className="text-xs text-muted-foreground">Only owners and admins can change this.</p>}
      {info && <p className="text-sm text-ws-green">{info}</p>}
      {error && <p className="text-sm text-ws-red">{error}</p>}
    </section>
  );
}
