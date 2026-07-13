// Parts pricing (#567). Pure: banded cost→sell markup + margin maths. Ex-VAT
// throughout (unit_price/cost_price are stored net). A markup rule is an
// ordered list of bands; the first band whose ceiling the cost falls under
// wins, else the open-ended catch-all band. Absent/invalid rules fall back to
// a single default multiplier so pricing always resolves.

export type MarkupBand = {
  /** Cost ceiling (£, ex-VAT) this band applies up to, inclusive. null = the
   *  open-ended "and above" catch-all. */
  upToCost: number | null;
  /** cost × multiplier = sell. */
  multiplier: number;
};

export const DEFAULT_MARKUP_RULES: MarkupBand[] = [{ upToCost: null, multiplier: 1.75 }];

const r2 = (n: number) => Math.round(n * 100) / 100;

// Defensive parse of the jsonb column → clean, sorted bands. Ascending by
// ceiling with the catch-all (null) last; drops malformed entries; guarantees
// at least the default and exactly one catch-all.
export function parseMarkupRules(raw: unknown): MarkupBand[] {
  if (!Array.isArray(raw)) return [...DEFAULT_MARKUP_RULES];
  const bands: MarkupBand[] = [];
  for (const b of raw as unknown[]) {
    if (!b || typeof b !== "object") continue;
    const rec = b as { upToCost?: unknown; multiplier?: unknown };
    const mult = Number(rec.multiplier);
    if (!Number.isFinite(mult) || mult <= 0) continue;
    const ceilingRaw = rec.upToCost;
    const ceiling =
      ceilingRaw === null || ceilingRaw === undefined || ceilingRaw === ""
        ? null
        : Number(ceilingRaw);
    if (ceiling !== null && (!Number.isFinite(ceiling) || ceiling <= 0)) continue;
    bands.push({ upToCost: ceiling, multiplier: r2(mult) });
  }
  if (bands.length === 0) return [...DEFAULT_MARKUP_RULES];

  const finite = bands.filter((b) => b.upToCost !== null).sort((a, b) => (a.upToCost as number) - (b.upToCost as number));
  const catchAll = bands.find((b) => b.upToCost === null);
  // Always end with a catch-all — reuse the top finite band's multiplier if the
  // user didn't give one, so a cost above every ceiling still prices.
  const tail = catchAll ?? { upToCost: null, multiplier: finite[finite.length - 1]?.multiplier ?? DEFAULT_MARKUP_RULES[0].multiplier };
  return [...finite, tail];
}

export function sellFromCost(cost: number, rules: MarkupBand[] = DEFAULT_MARKUP_RULES): number {
  const c = Number(cost);
  if (!Number.isFinite(c) || c < 0) return 0;
  const band = rules.find((b) => b.upToCost !== null && c <= (b.upToCost as number)) ?? rules.find((b) => b.upToCost === null) ?? DEFAULT_MARKUP_RULES[0];
  return r2(c * band.multiplier);
}

/** Ex-VAT margin as a whole-number percent of sell, or null when unpriceable. */
export function marginPct(cost: number, sell: number): number | null {
  const s = Number(sell);
  if (!Number.isFinite(s) || s <= 0) return null;
  return Math.round(((s - Number(cost)) / s) * 100);
}

/** A line is flagged when a target is set AND its margin is below it. Null
 *  margin (unpriceable) is never flagged here — it's the "missing cost" case. */
export function underTarget(margin: number | null, targetPct: number | null): boolean {
  return targetPct !== null && margin !== null && margin < targetPct;
}
