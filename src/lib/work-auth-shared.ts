// Client-safe half of work-auth (#503): pure maths + types. NO server-only
// imports — the counter-signature sheet shows the inc-VAT total before the
// customer signs, so this must be importable from client components (the
// -shared split rule; the admin-client half lives in work-auth.ts).

export type AuthItemSnapshot = {
  description: string;
  type: string;
  quantity: number;
  unit_price: number; // ex-VAT, as stored on job_items
  vat_rate: number; // percent snapshot (#514 per-line model)
};

// The figure the customer says yes to: line totals plus per-line VAT — the
// same maths the invoice will bill.
export function authorisedTotal(items: Pick<AuthItemSnapshot, "quantity" | "unit_price" | "vat_rate">[]): number {
  const total = items.reduce((sum, it) => {
    const net = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
    return sum + net * (1 + (Number(it.vat_rate) || 0) / 100);
  }, 0);
  return Math.round(total * 100) / 100;
}

// The variation check (#503 PR 4): does the job's live total exceed what the
// customer authorised, beyond the org's tolerance? Warn, never block.
export type VariationState =
  | { state: "none" } // no authorisation yet
  | { state: "ok"; authorised: number; live: number }
  | { state: "exceeds"; authorised: number; live: number; overBy: number; overPct: number };

export function variationState(
  liveTotal: number,
  authorised: number | null,
  thresholdPct: number,
): VariationState {
  if (authorised === null || !Number.isFinite(authorised)) return { state: "none" };
  const live = Math.round(liveTotal * 100) / 100;
  const tolerance = Math.max(0, Number(thresholdPct) || 0);
  const limit = authorised * (1 + tolerance / 100);
  if (live <= Math.round(limit * 100) / 100 || authorised <= 0) {
    return { state: "ok", authorised, live };
  }
  const overBy = Math.round((live - authorised) * 100) / 100;
  return {
    state: "exceeds",
    authorised,
    live,
    overBy,
    overPct: Math.round((overBy / authorised) * 100),
  };
}
