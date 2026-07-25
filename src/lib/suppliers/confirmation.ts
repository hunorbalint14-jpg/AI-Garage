// Parse a supplier's order confirmation that a staff member pasted in.
//
// The manual connector can't fetch confirmations (there is no API), so the
// round trip is closed by hand: the factor emails or prints a confirmation,
// staff paste it, and we pull out the supplier's order reference and the
// confirmed line costs. Every UK factor formats these differently, so this is
// deliberately forgiving — and deliberately conservative: a line only counts
// when quantity, description AND a unit cost all come out of it. Anything it
// can't read is left for the human, who still sees the raw text.
//
// Pure module (no server imports) — unit-tested in confirmation.test.ts.

import type { ConfirmedLine, OrderConfirmation } from "./types";

const MAX_LINES = 200;

// Lines that are totals/postage, not parts.
const SUMMARY_RE =
  /^\s*(sub[\s-]*total|total|vat|tax|delivery|carriage|shipping|postage|discount|goods|net|balance|amount due)\b/i;

// "Your ref" is OUR purchase-order number coming back to us — never the
// supplier's. Only these lead-ins identify THEIR reference.
const ORDER_REF_RE =
  /(?:^|\b)(?:our|supplier|sales|works|confirmation|order)\s*(?:order\s*)?(?:ref(?:erence)?|no\.?|number|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9\-/_]{2,})/i;

const SKU_IN_TEXT_RE =
  /\b(?:sku|part(?:\s*(?:no\.?|number|code))?|code)\s*[:#-]?\s*([A-Z0-9][A-Z0-9\-/.]{2,})/i;

const SKU_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9\-/.]{2,}$/;

/** "£1,234.56" / "1234.56" / "24,50" → 1234.56 / 24.5. NaN-safe: null on junk. */
function parseMoney(raw: string): number | null {
  const cleaned = raw.trim().replace(/[£$€\s]/g, "");
  if (!/^\d[\d,.]*$/.test(cleaned)) return null;
  // Treat a lone comma with 2 trailing digits as a decimal separator (24,50),
  // otherwise commas are thousands separators (1,234.56).
  const normalised = /^\d+,\d{2}$/.test(cleaned)
    ? cleaned.replace(",", ".")
    : cleaned.replace(/,/g, "");
  const n = Number(normalised);
  return Number.isFinite(n) ? n : null;
}

function looksLikeSku(field: string): boolean {
  return SKU_TOKEN_RE.test(field) && /\d/.test(field) && /[A-Za-z\-/.]/.test(field);
}

/** Split a row into fields: CSV, then TSV, then 2+ spaces. */
function splitFields(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map((f) => f.trim()).filter(Boolean);
  const commas = line.split(",").map((f) => f.trim()).filter(Boolean);
  if (commas.length >= 3) return commas;
  return line.split(/\s{2,}/).map((f) => f.trim()).filter(Boolean);
}

/**
 * Pick the unit cost from the money values on a row.
 *
 * Rows usually carry both a unit price and a line total. When quantity × one
 * value equals another, that first value is the unit price — that check is
 * exact enough to beat position. Failing that, a value tagged "each"/"ea" wins,
 * and failing that we take the FIRST money value, which is the near-universal
 * column order (… qty, unit, total).
 */
function pickUnitCost(monies: number[], qty: number, line: string): number | null {
  if (monies.length === 0) return null;
  if (monies.length > 1) {
    for (const candidate of monies) {
      const target = candidate * qty;
      if (monies.some((m) => m !== candidate && Math.abs(m - target) < 0.01)) return candidate;
    }
    const each = /([£$€]?\s*\d[\d,.]*)\s*(?:each|ea\b|per\s+unit)/i.exec(line);
    if (each) {
      const m = parseMoney(each[1]);
      if (m != null) return m;
    }
  }
  return monies[0];
}

// "2 x Brake Disc Pair (BD-9921) £42.50 each  £85.00"
function parseQuantityPrefixed(line: string): ConfirmedLine | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:x|×|\*)\s+(.*)$/i.exec(line);
  if (!m) return null;
  const qty = Number(m[1]);
  if (!(qty > 0)) return null;

  const rest = m[2];
  const monies: number[] = [];
  const moneyRe = /[£$€]\s*\d[\d,.]*|\b\d+[.,]\d{2}\b/g;
  let firstMoneyAt = rest.length;
  for (const hit of rest.matchAll(moneyRe)) {
    const value = parseMoney(hit[0]);
    if (value == null) continue;
    monies.push(value);
    firstMoneyAt = Math.min(firstMoneyAt, hit.index ?? rest.length);
  }
  const unitCost = pickUnitCost(monies, qty, rest);
  if (unitCost == null || unitCost <= 0) return null;

  // Description is everything before the first price.
  let description = rest.slice(0, firstMoneyAt).trim().replace(/[-–@:,]+$/, "").trim();
  const skuMatch = SKU_IN_TEXT_RE.exec(description) ?? /\(([A-Za-z0-9][A-Za-z0-9\-/.]{2,})\)\s*$/.exec(description);
  let sku: string | null = null;
  if (skuMatch && looksLikeSku(skuMatch[1])) {
    sku = skuMatch[1];
    description = description.replace(skuMatch[0], "").replace(/\(\s*\)/, "").trim();
  }
  description = description.replace(/[-–,]\s*$/, "").trim();
  if (!description) return null;

  return { sku, description, quantity: qty, unitCost };
}

// "BD-9921 , Brake Disc Pair Front , 2 , 42.50" (CSV / TSV / column-aligned)
function parseDelimited(line: string): ConfirmedLine | null {
  const fields = splitFields(line);
  if (fields.length < 3) return null;

  const monies: number[] = [];
  const moneyIdx = new Set<number>();
  fields.forEach((f, i) => {
    // A bare integer is a quantity, not money — only decimals or £-marked
    // values count as prices here.
    if (!/[£$€]/.test(f) && !/\d[.,]\d/.test(f)) return;
    const v = parseMoney(f);
    if (v != null) {
      monies.push(v);
      moneyIdx.add(i);
    }
  });
  if (monies.length === 0) return null;

  const qtyIdx = fields.findIndex((f, i) => !moneyIdx.has(i) && /^\d{1,4}$/.test(f.trim()));
  if (qtyIdx === -1) return null;
  const qty = Number(fields[qtyIdx]);
  if (!(qty > 0)) return null;

  const unitCost = pickUnitCost(monies, qty, line);
  if (unitCost == null || unitCost <= 0) return null;

  const textIdx = fields
    .map((f, i) => ({ f, i }))
    .filter(({ f, i }) => i !== qtyIdx && !moneyIdx.has(i) && /[A-Za-z]{2,}/.test(f));
  if (textIdx.length === 0) return null;

  // Longest wordy field is the description; a short code-like field is the SKU.
  const description = textIdx.reduce((a, b) => (b.f.length > a.f.length ? b : a)).f;
  const sku = textIdx.find(({ f }) => f !== description && looksLikeSku(f))?.f ?? null;

  return { sku, description, quantity: qty, unitCost };
}

/**
 * Pull the supplier's order reference + confirmed lines out of pasted text.
 * Always returns a value — an empty `lines` array means "couldn't read it",
 * which the caller surfaces rather than treating as a zero-line order.
 */
export function parseConfirmation(text: string): OrderConfirmation {
  const rows = (text ?? "").split(/\r?\n/).slice(0, MAX_LINES);

  let supplierOrderRef: string | null = null;
  for (const row of rows) {
    if (/your\s*(?:order\s*)?ref/i.test(row)) continue; // that one is ours
    const m = ORDER_REF_RE.exec(row);
    if (m) {
      supplierOrderRef = m[1].trim();
      break;
    }
  }

  const lines: ConfirmedLine[] = [];
  for (const row of rows) {
    const trimmed = row.trim();
    if (!trimmed || SUMMARY_RE.test(trimmed)) continue;
    if (supplierOrderRef && trimmed.includes(supplierOrderRef)) continue;

    const parsed = parseQuantityPrefixed(trimmed) ?? parseDelimited(trimmed);
    if (parsed) lines.push(parsed);
  }

  return { supplierOrderRef, lines };
}
