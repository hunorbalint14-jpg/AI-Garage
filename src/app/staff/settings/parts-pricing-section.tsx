"use client";

import { useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { savePartsPricing } from "./parts-pricing-actions";

// Parts pricing card (#567): banded cost→sell markup + a target margin. Bands
// are "cost up to £X → ×Y", with a final open-ended catch-all. Drives the AI
// part-suggestion guardrail on the job screen.

type Band = { upToCost: string; multiplier: string };

export function PartsPricingSection({
  initialBands,
  initialTarget,
  canEdit,
}: {
  initialBands: { upToCost: number | null; multiplier: number }[];
  initialTarget: number | null;
  canEdit: boolean;
}) {
  // Split into finite bands (editable ceilings) + the catch-all multiplier.
  const finite = initialBands.filter((b) => b.upToCost !== null);
  const catchAll = initialBands.find((b) => b.upToCost === null);
  const [bands, setBands] = useState<Band[]>(
    finite.length
      ? finite.map((b) => ({ upToCost: String(b.upToCost), multiplier: String(b.multiplier) }))
      : [],
  );
  const [catchMult, setCatchMult] = useState(String(catchAll?.multiplier ?? 1.75));
  const [target, setTarget] = useState(initialTarget !== null ? String(initialTarget) : "");
  const [pending, startTransition] = useTransition();
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function setBand(i: number, patch: Partial<Band>) {
    setBands((bs) => bs.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  }

  function save() {
    setInfo(null);
    setError(null);
    const parsedBands = [
      ...bands
        .filter((b) => b.upToCost.trim() !== "" && b.multiplier.trim() !== "")
        .map((b) => ({ upToCost: Number(b.upToCost), multiplier: Number(b.multiplier) })),
      { upToCost: null, multiplier: Number(catchMult) || 1.75 },
    ];
    const targetPct = target.trim() === "" ? null : Number(target);
    startTransition(async () => {
      const res = await savePartsPricing({ bands: parsedBands, targetPct });
      if ("error" in res) setError(res.error);
      else setInfo("Parts pricing saved.");
    });
  }

  const inputCls = "rounded-md border bg-transparent px-2 py-1.5 text-sm text-foreground";

  return (
    <section className="rounded-lg border p-4 flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold">Parts pricing</h2>
        <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">
          How cost becomes sell for suggested parts. Bands apply by cost — cheaper parts usually carry a higher
          multiplier. The target margin flags any suggested line that sells below it.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {bands.map((b, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Cost up to £</span>
            <input
              type="number"
              min={0}
              step="1"
              value={b.upToCost}
              onChange={(e) => setBand(i, { upToCost: e.target.value })}
              disabled={!canEdit || pending}
              className={`${inputCls} w-24`}
            />
            <span className="text-muted-foreground">→ ×</span>
            <input
              type="number"
              min={1}
              step="0.05"
              value={b.multiplier}
              onChange={(e) => setBand(i, { multiplier: e.target.value })}
              disabled={!canEdit || pending}
              className={`${inputCls} w-20`}
            />
            {canEdit && (
              <button
                type="button"
                onClick={() => setBands((bs) => bs.filter((_, idx) => idx !== i))}
                disabled={pending}
                aria-label="Remove band"
                className="rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Everything above → ×</span>
          <input
            type="number"
            min={1}
            step="0.05"
            value={catchMult}
            onChange={(e) => setCatchMult(e.target.value)}
            disabled={!canEdit || pending}
            className={`${inputCls} w-20`}
          />
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setBands((bs) => [...bs, { upToCost: "", multiplier: "" }])}
            disabled={pending}
            className="inline-flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" /> Add a band
          </button>
        )}
      </div>

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Target margin (%, empty = no flag)
        <input
          type="number"
          min={0}
          max={95}
          step="1"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          disabled={!canEdit || pending}
          placeholder="e.g. 40"
          className={`${inputCls} w-28`}
        />
      </label>

      {canEdit ? (
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={save} loading={pending}>
            Save
          </Button>
          {info && <p className="text-sm text-ws-green">{info}</p>}
          {error && <p className="text-sm text-ws-red">{error}</p>}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Only owners and admins can change parts pricing.</p>
      )}
    </section>
  );
}
