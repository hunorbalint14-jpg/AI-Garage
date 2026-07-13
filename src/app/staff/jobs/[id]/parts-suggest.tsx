"use client";

import { useState, useTransition } from "react";
import { Sparkles, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { suggestPartsForJob, addJobItem, type SuggestedPart } from "../actions";

// AI parts suggestion panel (#567). "Suggest parts (AI)" → priced suggestions
// matched to the branch catalogue, each with a margin badge and one-tap add.
// Adds go through the normal addJobItem (product link snapshots cost); the
// page revalidates so the line appears in the items table.

const fmtGBP = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

export function PartsSuggest({ jobId }: { jobId: string }) {
  const [suggesting, startSuggest] = useTransition();
  const [parts, setParts] = useState<SuggestedPart[] | null>(null);
  const [added, setAdded] = useState<Set<number>>(new Set());
  const [addingIdx, setAddingIdx] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    startSuggest(async () => {
      const res = await suggestPartsForJob(jobId);
      if ("error" in res) {
        setError(res.error);
        setParts([]);
      } else {
        setParts(res.parts);
        setAdded(new Set());
      }
    });
  }

  async function add(i: number, p: SuggestedPart) {
    setError(null);
    setAddingIdx(i);
    const fd = new FormData();
    fd.set("description", p.name);
    fd.set("type", "part");
    fd.set("quantity", String(p.quantity));
    fd.set("unitPrice", String(p.sell ?? 0));
    if (p.productId) fd.set("productId", p.productId);
    const res = await addJobItem(jobId, fd);
    setAddingIdx(null);
    if ("error" in res) setError(res.error);
    else setAdded((s) => new Set(s).add(i));
  }

  return (
    <div className="p-4 border-t flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" variant="outline" onClick={run} loading={suggesting}>
          <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Suggest parts (AI)
        </Button>
        <span className="text-xs text-muted-foreground">From the job description &amp; vehicle — priced from your catalogue.</span>
        {error && <span className="text-xs text-ws-red">{error}</span>}
      </div>

      {parts && parts.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {parts.map((p, i) => {
            const isAdded = added.has(i);
            return (
              <li
                key={`${p.name}-${i}`}
                className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm ${isAdded ? "opacity-60" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium">
                      {p.quantity !== 1 ? `${p.quantity} × ` : ""}
                      {p.name}
                    </span>
                    <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{p.category}</span>
                    {p.productName ? (
                      <span className="text-xs text-muted-foreground">· {p.productName}</span>
                    ) : (
                      <span className="text-xs text-ws-amber">· no catalogue match</span>
                    )}
                  </div>
                  {p.caveat && <div className="mt-0.5 text-xs text-muted-foreground">{p.caveat}</div>}
                </div>

                <div className="flex items-center gap-2 whitespace-nowrap text-xs">
                  {p.sell !== null ? (
                    <span className="tabular-nums">
                      {p.cost !== null && <span className="text-muted-foreground">{fmtGBP(p.cost)} → </span>}
                      <span className="font-semibold">{fmtGBP(p.sell)}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">set price</span>
                  )}
                  {p.marginPct !== null ? (
                    <span
                      className={`rounded px-1.5 py-0.5 font-mono ${p.underTarget ? "bg-amber-500/15 text-ws-amber" : "bg-ws-green/15 text-ws-green"}`}
                    >
                      {p.marginPct}%{p.underTarget ? " ⚠" : ""}
                    </span>
                  ) : (
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground">no cost</span>
                  )}
                </div>

                {isAdded ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-ws-green">
                    <Check className="h-3.5 w-3.5" /> Added
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void add(i, p)}
                    disabled={addingIdx !== null}
                    className="rounded-md border px-2.5 py-1 text-xs font-semibold hover:bg-accent disabled:opacity-50"
                  >
                    {addingIdx === i ? "Adding…" : "Add"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {parts && parts.length === 0 && !error && (
        <p className="text-xs text-muted-foreground">No parts suggested — add them by hand below.</p>
      )}
    </div>
  );
}
