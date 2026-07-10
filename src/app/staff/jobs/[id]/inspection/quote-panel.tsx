"use client";

import Link from "next/link";
import { useState } from "react";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateInspectionQuote } from "./actions";
import type { CaptureItem } from "./inspection-capture";

// eVHC Phase 4 (#497): "Quote the red & amber items". Staff pick findings and
// confirm a price per line (prefilled from the AI suggestion); one draft
// unified quote is created on the job — review + send happens on the normal
// quote detail page. A live quote locks the panel; a cancelled one releases
// the findings for re-quoting (server-enforced).

const QUOTE_STATUS_LABEL: Record<string, string> = {
  draft: "Draft quote created",
  pending: "Quote with the customer",
  approved: "Quote approved",
  declined: "Quote declined",
  expired: "Quote expired",
};

export function InspectionQuotePanel({
  inspectionId,
  items,
  quote,
  readOnly,
  onQuoted,
}: {
  inspectionId: string;
  items: CaptureItem[];
  quote: { id: string; status: string } | null;
  readOnly: boolean;
  onQuoted: (quoteId: string, itemIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [prices, setPrices] = useState<Map<string, string>>(new Map());

  const liveQuote = quote && quote.status !== "cancelled" ? quote : null;
  const eligible = items.filter((i) => (i.rag === "amber" || i.rag === "red") && i.outcome === "none");

  if (liveQuote) {
    return (
      <div className="rounded-lg border px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4 text-muted-foreground" />
            {QUOTE_STATUS_LABEL[liveQuote.status] ?? `Quote ${liveQuote.status}`}
          </p>
          <Link
            href={`/staff/quotes/${liveQuote.id}`}
            className="text-sm text-muted-foreground underline underline-offset-2"
          >
            Review & send →
          </Link>
        </div>
      </div>
    );
  }

  if (readOnly || eligible.length === 0) return null;

  function openPanel() {
    // Default: everything selected, prices seeded from the AI suggestion.
    setSelected(new Set(eligible.map((e) => e.id)));
    setPrices(new Map(eligible.map((e) => [e.id, e.suggestedPrice !== null ? e.suggestedPrice.toFixed(2) : ""])));
    setError(null);
    setOpen(true);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const parsePrice = (id: string) => {
    const n = parseFloat(prices.get(id) ?? "");
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const total = eligible.filter((e) => selected.has(e.id)).reduce((sum, e) => sum + parsePrice(e.id), 0);

  async function handleCreate() {
    const sel = eligible.filter((e) => selected.has(e.id)).map((e) => ({ itemId: e.id, price: parsePrice(e.id) }));
    if (sel.length === 0) return setError("Select at least one finding.");
    setBusy(true);
    setError(null);
    const res = await generateInspectionQuote(inspectionId, sel);
    setBusy(false);
    if ("error" in res) return setError(res.error);
    setOpen(false);
    onQuoted(res.quoteId, res.quotedItemIds);
  }

  if (!open) {
    return (
      <div className="rounded-lg border px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {eligible.length} finding{eligible.length === 1 ? "" : "s"} ready to price up.
          </p>
          <Button size="sm" onClick={openPanel}>
            <FileText className="h-3.5 w-3.5" /> Quote the red & amber items
          </Button>
        </div>
      </div>
    );
  }

  return (
    <section className="rounded-lg border">
      <h2 className="border-b px-4 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ws-text-3">
        Quote the findings
      </h2>
      <ul>
        {eligible.map((item) => (
          <li key={item.id} className="border-b px-4 py-3 last:border-b-0">
            <label className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2.5 text-sm leading-snug">
                <input
                  type="checkbox"
                  checked={selected.has(item.id)}
                  onChange={() => toggle(item.id)}
                  className="h-4 w-4 shrink-0 accent-current"
                />
                <span>
                  {item.label}
                  {item.suggestedRepair && (
                    <span className="block text-xs text-muted-foreground">{item.suggestedRepair}</span>
                  )}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1 text-sm">
                £
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={prices.get(item.id) ?? ""}
                  onChange={(e) => setPrices((prev) => new Map(prev).set(item.id, e.target.value))}
                  disabled={!selected.has(item.id)}
                  placeholder="0.00"
                  className="w-24 rounded-md border bg-transparent px-2 py-1.5 text-right text-sm tabular-nums placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                />
              </span>
            </label>
          </li>
        ))}
      </ul>
      {error && <p className="px-4 pt-3 text-sm text-ws-red">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <p className="text-sm tabular-nums text-muted-foreground">
          Subtotal (ex VAT): <span className="font-semibold text-foreground">£{total.toFixed(2)}</span>
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleCreate} loading={busy}>
            Create draft quote
          </Button>
        </div>
      </div>
    </section>
  );
}
