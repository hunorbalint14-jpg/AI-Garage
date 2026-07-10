"use client";

import { useMemo, useState } from "react";

// eVHC report approval rail (#497 Phase 5). Per-finding approve/decline
// toggles driving the linked unified quote. Everything is opt-out: all
// priced findings start approved — the customer unticks what they don't
// want, exactly like the quote page's per-item flow.

import { respondToCheck } from "./actions";

export type PricedFinding = {
  inspectionItemId: string;
  quoteItemId: string;
  label: string;
  price: number;
  rag: "red" | "amber";
};

function formatGBP(n: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

const STATUS_BANNER: Record<string, string> = {
  approved: "You've approved this work — the garage has been notified and will be in touch.",
  approved_after_close: "You approved this work after the job closed — the garage will contact you to arrange it.",
  declined: "You declined this work. Contact the garage if you change your mind.",
  expired: "The approval window for this work has expired. Contact the garage to go ahead.",
  cancelled: "This quote was withdrawn by the garage. Contact them for details.",
};

export function CheckResponse({
  slug,
  token,
  primaryColor,
  quoteStatus,
  respondedAt,
  expiresAt,
  vatRate,
  findings,
  garagePhone,
}: {
  slug: string;
  token: string;
  primaryColor: string;
  quoteStatus: string;
  respondedAt: string | null;
  expiresAt: string | null;
  vatRate: number;
  findings: PricedFinding[];
  garagePhone: string | null;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(findings.map((f) => f.quoteItemId)));
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"approved" | "declined" | null>(null);

  const totals = useMemo(() => {
    const subtotal = findings.filter((f) => selected.has(f.quoteItemId)).reduce((s, f) => s + f.price, 0);
    const sub = Math.round(subtotal * 100) / 100;
    const vat = Math.round(sub * vatRate) / 100;
    return { sub, vat, total: Math.round((sub + vat) * 100) / 100 };
  }, [findings, selected, vatRate]);

  if (quoteStatus !== "pending" || done) {
    const text = done
      ? done === "approved"
        ? STATUS_BANNER.approved
        : STATUS_BANNER.declined
      : STATUS_BANNER[quoteStatus] ?? null;
    if (!text) return null;
    return (
      <section className="rounded-lg border bg-white p-4">
        <p className="text-sm">
          {text}
          {respondedAt && !done && (
            <span className="text-slate-500">
              {" "}({new Date(respondedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })})
            </span>
          )}
        </p>
      </section>
    );
  }

  if (findings.length === 0) return null;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submitApprove() {
    setBusy(true);
    setError(null);
    const res = await respondToCheck(slug, token, { approvedQuoteItemIds: [...selected] });
    setBusy(false);
    if ("error" in res) return setError(res.error);
    if (res.depositUrl) {
      window.location.href = res.depositUrl;
      return;
    }
    setDone("approved");
  }

  async function submitDecline() {
    setBusy(true);
    setError(null);
    const res = await respondToCheck(slug, token, { declineReason: reason.trim() || null });
    setBusy(false);
    if ("error" in res) return setError(res.error);
    setDone("declined");
  }

  return (
    <section className="rounded-lg border bg-white overflow-hidden">
      <div className="px-4 py-2 bg-slate-50 border-b text-xs font-medium uppercase tracking-wide text-slate-500">
        Approve the recommended work
      </div>
      <ul className="divide-y">
        {findings.map((f) => (
          <li key={f.quoteItemId} className="px-4 py-3">
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <span className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={selected.has(f.quoteItemId)}
                  onChange={() => toggle(f.quoteItemId)}
                  disabled={busy}
                  className="h-5 w-5 accent-current"
                  style={{ color: primaryColor }}
                />
                <span>
                  {f.label}
                  <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${f.rag === "red" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                    {f.rag === "red" ? "Urgent" : "Advisory"}
                  </span>
                </span>
              </span>
              <span className="shrink-0 text-sm tabular-nums">{formatGBP(f.price)}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="border-t bg-slate-50 px-4 py-3 text-sm">
        <div className="flex justify-between text-slate-500">
          <span>Subtotal</span>
          <span className="tabular-nums">{formatGBP(totals.sub)}</span>
        </div>
        <div className="flex justify-between text-slate-500">
          <span>VAT ({vatRate}%)</span>
          <span className="tabular-nums">{formatGBP(totals.vat)}</span>
        </div>
        <div className="flex justify-between font-bold mt-1">
          <span>Total if approved</span>
          <span className="tabular-nums" style={{ color: primaryColor }}>{formatGBP(totals.total)}</span>
        </div>
      </div>

      {error && <p className="px-4 pt-3 text-sm text-red-600">{error}</p>}

      <div className="px-4 py-4 flex flex-col gap-3">
        {!declining ? (
          <>
            <button
              type="button"
              onClick={submitApprove}
              disabled={busy || selected.size === 0}
              className="w-full rounded-lg px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: primaryColor }}
            >
              {busy ? "Sending…" : `Approve ${selected.size} of ${findings.length} item${findings.length === 1 ? "" : "s"} — ${formatGBP(totals.total)}`}
            </button>
            <button
              type="button"
              onClick={() => setDeclining(true)}
              disabled={busy}
              className="w-full rounded-lg border px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              Decline all
            </button>
          </>
        ) : (
          <>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Optional — tell the garage why (helps them help you next time)"
              className="w-full rounded-lg border px-3 py-2 text-sm"
              disabled={busy}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={submitDecline}
                disabled={busy}
                className="flex-1 rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Sending…" : "Confirm decline"}
              </button>
              <button
                type="button"
                onClick={() => setDeclining(false)}
                disabled={busy}
                className="rounded-lg border px-4 py-2.5 text-sm text-slate-600"
              >
                Back
              </button>
            </div>
          </>
        )}
        <p className="text-center text-xs text-slate-500">
          {expiresAt && (
            <>Respond by {new Date(expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}. </>
          )}
          Unticked items are recorded as declined — you can arrange them later
          {garagePhone ? (
            <>
              {" "}on <a href={`tel:${garagePhone}`} className="underline">{garagePhone}</a>
            </>
          ) : null}
          .
        </p>
      </div>
    </section>
  );
}
