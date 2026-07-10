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

// ── Period aggregation (#502 PR 2) ──────────────────────────────────────────

export type PeriodJob = {
  lines: MarginLine[];
  clockedMinutes: number;
  /** Dominant service category (largest labour line's service), or "General". */
  category: string;
};

export type CategoryMargin = {
  category: string;
  jobs: number;
  sell: number;
  /** null when any job in the bucket has unknown costs. */
  grossProfit: number | null;
  marginPct: number | null;
};

export type PeriodMargin = {
  jobs: number;
  sell: number;
  partsSell: number;
  partsCost: number;
  unknownPartCostCount: number;
  partsMarginPct: number | null;
  labourSold: number;
  clockedMinutes: number;
  labourCost: number | null;
  effectiveLabourRate: number | null;
  grossProfit: number | null;
  grossMarginPct: number | null;
  byCategory: CategoryMargin[];
};

// Sum per-job margins across a period. Unknowns poison only what they touch:
// one uncosted part nulls the period GP (and its category's), but ELR and
// the known sums still report.
export function aggregateMargins(jobs: PeriodJob[], labourCostRate: number | null): PeriodMargin {
  const per = jobs.map((j) => ({ margin: computeJobMargin(j.lines, j.clockedMinutes, labourCostRate), category: j.category }));

  const sum = (f: (m: JobMargin) => number) => r2(per.reduce((s, p) => s + f(p.margin), 0));
  const sell = sum((m) => m.totalSell);
  const partsSell = sum((m) => m.partsSell);
  const partsCost = sum((m) => m.partsCost);
  const unknownPartCostCount = per.reduce((s, p) => s + p.margin.unknownPartCostCount, 0);
  const labourSold = sum((m) => m.labourSold);
  const clockedMinutes = per.reduce((s, p) => s + p.margin.clockedMinutes, 0);
  const rateKnown = labourCostRate !== null && Number.isFinite(labourCostRate);
  const labourCost = rateKnown ? r2((clockedMinutes / 60) * Number(labourCostRate)) : null;
  const costsKnown = unknownPartCostCount === 0 && labourCost !== null;
  const grossProfit = costsKnown ? r2(sell - partsCost - labourCost!) : null;

  const byCat = new Map<string, { jobs: number; sell: number; gp: number; known: boolean }>();
  for (const p of per) {
    const c = byCat.get(p.category) ?? { jobs: 0, sell: 0, gp: 0, known: true };
    c.jobs += 1;
    c.sell = r2(c.sell + p.margin.totalSell);
    if (p.margin.grossProfit === null) c.known = false;
    else c.gp = r2(c.gp + p.margin.grossProfit);
    byCat.set(p.category, c);
  }
  const byCategory: CategoryMargin[] = [...byCat.entries()]
    .map(([category, c]) => ({
      category,
      jobs: c.jobs,
      sell: c.sell,
      grossProfit: c.known ? c.gp : null,
      marginPct: c.known && c.sell > 0 ? Math.round((c.gp / c.sell) * 100) : null,
    }))
    .sort((a, b) => b.sell - a.sell);

  return {
    jobs: jobs.length,
    sell,
    partsSell,
    partsCost,
    unknownPartCostCount,
    partsMarginPct: unknownPartCostCount === 0 && partsSell > 0 ? Math.round(((partsSell - partsCost) / partsSell) * 100) : null,
    labourSold,
    clockedMinutes,
    labourCost,
    effectiveLabourRate: clockedMinutes > 0 ? r2(labourSold / (clockedMinutes / 60)) : null,
    grossProfit,
    grossMarginPct: grossProfit !== null && sell > 0 ? Math.round((grossProfit / sell) * 100) : null,
    byCategory,
  };
}

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
