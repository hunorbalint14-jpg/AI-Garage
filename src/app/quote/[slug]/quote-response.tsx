"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, X, Calendar } from "lucide-react";
import { approveQuote, declineQuote, declineAndRebook } from "./actions";

type QuoteItem = {
  id: string;
  description: string;
  type: string;
  quantity: number;
  unit_price: number;
};

type Stage = "idle" | "decline-form" | "submitting" | "approved" | "declined" | "rebooked" | "error";

function formatGBP(n: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

const VAT_RATE = 0.2;

export function QuoteResponse({
  slug,
  token,
  primaryColor,
  items,
  depositPct,
  showRebookCta = true,
}: {
  slug: string;
  token: string;
  primaryColor: string;
  items: QuoteItem[];
  depositPct: number;
  showRebookCta?: boolean;
}) {
  const [stage, setStage] = useState<Stage>("idle");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // All items selected by default — partial approval is opt-out, not opt-in.
  const [selectedIds, setSelectedIds] = useState<string[]>(() => items.map((it) => it.id));

  const selectedSubtotal = useMemo(() => {
    const set = new Set(selectedIds);
    return items
      .filter((it) => set.has(it.id))
      .reduce((sum, it) => sum + it.quantity * it.unit_price, 0);
  }, [items, selectedIds]);
  const selectedVat = Math.round(selectedSubtotal * VAT_RATE * 100) / 100;
  const selectedTotal = Math.round((selectedSubtotal + selectedVat) * 100) / 100;
  const depositAmount = depositPct > 0 ? Math.round(selectedTotal * (depositPct / 100) * 100) / 100 : 0;

  const allSelected = selectedIds.length === items.length;
  const noneSelected = selectedIds.length === 0;

  function toggleItem(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function handleApprove() {
    if (noneSelected) {
      setError("Tick at least one item to approve.");
      return;
    }
    const partial = !allSelected;
    const message = depositPct > 0
      ? `Approve ${partial ? "the ticked items" : "this quote"} and pay a ${depositPct}% deposit (${formatGBP(depositAmount)}) now?`
      : `Approve ${partial ? "the ticked items" : "this quote"}? The work will be added to your job and invoiced when complete.`;
    if (!confirm(message)) return;

    setError(null);
    setStage("submitting");
    // Pass [] when all items are selected so the server treats it as "approve all"
    // — keeps the metadata cleaner and avoids transmitting a giant ID list.
    const ids = allSelected ? [] : selectedIds;
    startTransition(async () => {
      const result = await approveQuote(slug, token, ids);
      if ("error" in result) {
        setError(result.error);
        setStage("error");
        return;
      }
      if (result.depositUrl) {
        window.location.href = result.depositUrl;
        return;
      }
      setStage("approved");
    });
  }

  function handleDeclineSubmit() {
    setError(null);
    setStage("submitting");
    startTransition(async () => {
      const result = await declineQuote(slug, token, reason.trim() || null);
      if ("error" in result) {
        setError(result.error);
        setStage("error");
        return;
      }
      setStage("declined");
    });
  }

  function handleRebook() {
    if (!confirm("Skip this work for now and book it as a separate appointment?")) return;
    setError(null);
    setStage("submitting");
    startTransition(async () => {
      const result = await declineAndRebook(slug, token);
      if ("error" in result) {
        setError(result.error);
        setStage("error");
        return;
      }
      window.location.href = result.rebookUrl;
    });
  }

  if (stage === "approved") {
    return (
      <section className="rounded-lg border bg-green-50 p-6 text-center">
        <Check className="h-10 w-10 mx-auto text-green-600 mb-2" />
        <h2 className="text-lg font-semibold">Quote approved</h2>
        <p className="text-sm text-slate-600 mt-1">
          We&rsquo;ll continue with the work and let you know when it&rsquo;s ready. Payment will be requested when the job is complete.
        </p>
      </section>
    );
  }

  if (stage === "declined") {
    return (
      <section className="rounded-lg border bg-slate-100 p-6 text-center">
        <X className="h-10 w-10 mx-auto text-slate-600 mb-2" />
        <h2 className="text-lg font-semibold">Quote declined</h2>
        <p className="text-sm text-slate-600 mt-1">
          Thanks for letting us know. We won&rsquo;t do the extra work — your job will be completed as originally booked.
        </p>
      </section>
    );
  }

  if (stage === "rebooked") {
    return (
      <section className="rounded-lg border bg-blue-50 p-6 text-center">
        <Calendar className="h-10 w-10 mx-auto text-blue-600 mb-2" />
        <h2 className="text-lg font-semibold">Redirecting to booking…</h2>
      </section>
    );
  }

  if (stage === "decline-form") {
    return (
      <section className="rounded-lg border bg-white p-4 flex flex-col gap-3">
        <h2 className="text-sm font-medium">Why are you declining? (optional)</h2>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Too expensive right now, or I want a second opinion."
          rows={3}
          disabled={pending}
          className="w-full rounded-md border px-3 py-2 text-sm"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleDeclineSubmit}
            disabled={pending}
            className="flex-1 rounded-md bg-slate-800 text-white px-4 py-3 text-sm font-medium disabled:opacity-50"
          >
            {pending ? "Sending…" : "Confirm decline"}
          </button>
          <button
            type="button"
            onClick={() => setStage("idle")}
            disabled={pending}
            className="rounded-md border px-4 py-3 text-sm font-medium disabled:opacity-50"
          >
            Back
          </button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      {/* Per-item checkboxes — only render when there are 2+ items (single-item
          quotes don't benefit from partial-approval UI). */}
      {items.length > 1 && (
        <div className="rounded-lg border bg-white p-3">
          <div className="text-xs font-medium text-slate-600 mb-2 flex items-center justify-between">
            <span>Tick the items you want to approve</span>
            <button
              type="button"
              onClick={() => setSelectedIds(allSelected ? [] : items.map((it) => it.id))}
              className="text-xs underline text-slate-500"
            >
              {allSelected ? "Untick all" : "Tick all"}
            </button>
          </div>
          <ul className="divide-y">
            {items.map((it) => {
              const checked = selectedIds.includes(it.id);
              return (
                <li key={it.id} className="py-2">
                  <label className="flex gap-2 items-start cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleItem(it.id)}
                      className="mt-1 h-4 w-4"
                    />
                    <div className="flex-1 text-sm">
                      <div className={checked ? "" : "line-through text-slate-400"}>{it.description}</div>
                      <div className="text-xs text-slate-500 capitalize">
                        {it.type} · {it.quantity} × {formatGBP(it.unit_price)}
                      </div>
                    </div>
                    <div className={`text-sm tabular-nums ${checked ? "" : "line-through text-slate-400"}`}>
                      {formatGBP(it.quantity * it.unit_price)}
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 pt-3 border-t text-sm flex justify-between font-semibold">
            <span>Selected total (inc. VAT)</span>
            <span className="tabular-nums" style={{ color: primaryColor }}>{formatGBP(selectedTotal)}</span>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={handleApprove}
        disabled={pending || noneSelected}
        className="w-full rounded-md text-white px-4 py-4 text-base font-semibold disabled:opacity-50"
        style={{ background: primaryColor }}
      >
        {pending && stage === "submitting"
          ? "Sending…"
          : depositPct > 0
            ? `✓ Approve & pay ${depositPct}% deposit (${formatGBP(depositAmount)})`
            : items.length > 1 && !allSelected
              ? `✓ Approve ${selectedIds.length} item${selectedIds.length === 1 ? "" : "s"}`
              : "✓ Approve & continue work"}
      </button>

      {showRebookCta && (
        <button
          type="button"
          onClick={handleRebook}
          disabled={pending}
          className="w-full rounded-md border bg-white px-4 py-3 text-sm font-medium text-slate-700 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <Calendar className="h-4 w-4" /> Skip for now — book a separate appointment
        </button>
      )}

      <button
        type="button"
        onClick={() => setStage("decline-form")}
        disabled={pending}
        className="w-full rounded-md border bg-white px-4 py-3 text-sm font-medium text-slate-500 disabled:opacity-50"
      >
        Decline — don&rsquo;t do the extra work
      </button>

      {error && <p className="text-sm text-red-600 text-center">{error}</p>}
    </section>
  );
}
