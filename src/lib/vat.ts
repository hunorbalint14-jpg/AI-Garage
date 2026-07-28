export const STANDARD_VAT_RATE = 20;

// UK VAT treatment of a catalogue service. `standard` carries the standard
// rate; the other three all charge 0% on the line but differ on the VAT
// return (zero-rated vs exempt vs outside the scope — e.g. the MOT test fee).
export type VatTreatment = "standard" | "zero" | "exempt" | "outside_scope";

export const VAT_TREATMENTS: readonly VatTreatment[] = ["standard", "zero", "exempt", "outside_scope"];

export const VAT_TREATMENT_LABELS: Record<VatTreatment, string> = {
  standard: "Standard rate (20%)",
  zero: "Zero-rated (0%)",
  exempt: "VAT exempt",
  outside_scope: "Outside the scope (e.g. MOT fee)",
};

export function isVatTreatment(v: unknown): v is VatTreatment {
  return typeof v === "string" && (VAT_TREATMENTS as readonly string[]).includes(v);
}

export function vatRateFor(treatment: VatTreatment, standardRate: number = STANDARD_VAT_RATE): number {
  return treatment === "standard" ? standardRate : 0;
}

// Treatment of a stored line. Lines written since the vat_treatment snapshot
// carry it explicitly; legacy lines only have the numeric rate, where 0% is
// unknowable (zero-rated vs exempt vs outside-scope) — those fall back to
// outside_scope, which keeps the accounting push identical to the historic
// behaviour (the provider's no-VAT code) instead of guessing a Box 6 change.
export function lineTreatmentOf(
  treatment: unknown,
  vatRate: number | null | undefined,
): VatTreatment {
  if (isVatTreatment(treatment)) return treatment;
  return Number(vatRate ?? STANDARD_VAT_RATE) > 0 ? "standard" : "outside_scope";
}

// Loose format check for a UK VAT registration number: 9 digits (12 for
// branch traders), or GD/HA + 3 digits for government/health bodies, with
// an optional GB prefix and spaces. Format-only — no HMRC/VIES lookup.
export function isLikelyUkVatNumber(v: string): boolean {
  const s = v.toUpperCase().replace(/\s/g, "").replace(/^GB/, "");
  return /^\d{9}(\d{3})?$/.test(s) || /^(GD|HA)\d{3}$/.test(s);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Invoice-level VAT across mixed-rate lines. Deductions (member discount +
// membership credit) are applied pro-rata across the lines' VAT, and the
// blended effective rate is what gets stored on invoices.vat_rate so
// downstream consumers (refund credit-note splitting) stay consistent.
export function computeInvoiceVat(
  lines: { net: number; quantity: number; vatRate: number }[],
  deductions: number,
): { vatAmount: number; effectiveRate: number } {
  const grossNet = lines.reduce((s, l) => s + (Number(l.net) || 0) * (Number(l.quantity) || 0), 0);
  const lineVat = lines.reduce(
    (s, l) => s + ((Number(l.net) || 0) * (Number(l.quantity) || 0) * (Number(l.vatRate) || 0)) / 100,
    0,
  );
  const netAfter = Math.max(0, grossNet - Math.max(0, deductions));
  const scale = grossNet > 0 ? netAfter / grossNet : 0;
  const vatAmount = round2(lineVat * scale);
  const effectiveRate = netAfter > 0 ? round2((vatAmount / netAfter) * 100) : 0;
  return { vatAmount, effectiveRate };
}

// Net unit price for a catalogue service line landing on an invoice.
//
// Service prices flagged `vat_included` (the default) are GROSS — they're what
// the customer sees on the booking widget and what Checkout charges. Job
// invoices compute VAT *exclusively* on top of line prices, so a gross price
// must have VAT backed out first or the customer is charged VAT twice over
// the advertised price (#451: £54.85 MOT online vs £65.82 via job invoice).
export function serviceNetUnitPrice(
  price: number,
  vatIncluded: boolean,
  vatRate: number = STANDARD_VAT_RATE,
): number {
  const p = Number(price) || 0;
  if (!vatIncluded) return round2(p);
  return round2(p / (1 + vatRate / 100));
}
