// Job profitability maths (#502). Pure and ex-VAT throughout — margins are
// computed on net figures (unit_price is stored ex-VAT). Unknowns stay
// unknown: a part without a cost snapshot or a missing labour cost rate
// yields nulls + counters, never a guessed number.

export type MarginLine = {
  type: string; // 'part' | 'labour' | 'other'
  quantity: number;
  unit_price: number; // ex-VAT sell
  unit_cost: number | null; // ex-VAT cost snapshot; null = unknown
};

export type JobMargin = {
  /** Ex-VAT revenue by bucket. */
  partsSell: number;
  labourSold: number;
  otherSell: number;
  totalSell: number;
  /** Sum of KNOWN part costs; lines missing a cost are counted, not guessed. */
  partsCost: number;
  unknownPartCostCount: number;
  /** null until every part line has a cost. */
  partsMarginPct: number | null;
  clockedMinutes: number;
  /** clocked hours × org labour cost rate; null when no rate configured. */
  labourCost: number | null;
  /** Labour £ invoiced ÷ clocked hours — the steering number. Null when nothing clocked. */
  effectiveLabourRate: number | null;
  /** totalSell − partsCost − labourCost. Null when either side is unknown. */
  grossProfit: number | null;
  grossMarginPct: number | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function computeJobMargin(
  lines: MarginLine[],
  clockedMinutes: number,
  labourCostRate: number | null,
): JobMargin {
  const sell = (t: string) =>
    r2(
      lines
        .filter((l) => l.type === t)
        .reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0),
    );
  const partsSell = sell("part");
  const labourSold = sell("labour");
  const otherSell = sell("other");
  const totalSell = r2(partsSell + labourSold + otherSell);

  const partLines = lines.filter((l) => l.type === "part");
  const unknownPartCostCount = partLines.filter((l) => l.unit_cost === null || l.unit_cost === undefined).length;
  const partsCost = r2(
    partLines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_cost ?? 0) || 0), 0),
  );
  const partsMarginPct =
    unknownPartCostCount === 0 && partsSell > 0 ? Math.round(((partsSell - partsCost) / partsSell) * 100) : null;

  const minutes = Math.max(0, Math.round(clockedMinutes));
  const rate = labourCostRate !== null && Number.isFinite(labourCostRate) ? Number(labourCostRate) : null;
  const labourCost = rate !== null ? r2((minutes / 60) * rate) : null;
  const effectiveLabourRate = minutes > 0 ? r2(labourSold / (minutes / 60)) : null;

  const costsKnown = unknownPartCostCount === 0 && labourCost !== null;
  const grossProfit = costsKnown ? r2(totalSell - partsCost - labourCost!) : null;
  const grossMarginPct =
    grossProfit !== null && totalSell > 0 ? Math.round((grossProfit / totalSell) * 100) : null;

  return {
    partsSell,
    labourSold,
    otherSell,
    totalSell,
    partsCost,
    unknownPartCostCount,
    partsMarginPct,
    clockedMinutes: minutes,
    labourCost,
    effectiveLabourRate,
    grossProfit,
    grossMarginPct,
  };
}
