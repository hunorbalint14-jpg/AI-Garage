import { describe, expect, it } from "vitest";
import { aggregateMargins, computeJobMargin, type MarginLine, type PeriodJob } from "./margin";

const line = (type: string, qty: number, sell: number, cost: number | null): MarginLine => ({
  type,
  quantity: qty,
  unit_price: sell,
  unit_cost: cost,
});

describe("computeJobMargin", () => {
  it("full picture when every cost is known", () => {
    const m = computeJobMargin(
      [line("part", 1, 185, 110), line("part", 2, 20, 8), line("labour", 1.5, 65, null), line("other", 1, 10, null)],
      90, // 1.5h clocked
      30, // £30/h cost rate
    );
    expect(m.partsSell).toBe(225);
    expect(m.partsCost).toBe(126);
    expect(m.partsMarginPct).toBe(44); // (225-126)/225
    expect(m.labourSold).toBe(97.5);
    expect(m.labourCost).toBe(45);
    expect(m.effectiveLabourRate).toBe(65); // 97.5 / 1.5h
    expect(m.totalSell).toBe(332.5);
    expect(m.grossProfit).toBe(161.5); // 332.5 - 126 - 45
    expect(m.grossMarginPct).toBe(49);
  });

  it("unknown part cost → parts margin and GP stay null, counter set", () => {
    const m = computeJobMargin([line("part", 1, 185, null), line("part", 1, 20, 8)], 60, 30);
    expect(m.unknownPartCostCount).toBe(1);
    expect(m.partsCost).toBe(8); // known costs only
    expect(m.partsMarginPct).toBeNull();
    expect(m.grossProfit).toBeNull();
    expect(m.grossMarginPct).toBeNull();
  });

  it("no labour cost rate → labour cost and GP null, ELR still computed", () => {
    const m = computeJobMargin([line("labour", 2, 65, null)], 120, null);
    expect(m.labourCost).toBeNull();
    expect(m.effectiveLabourRate).toBe(65);
    expect(m.grossProfit).toBeNull();
  });

  it("nothing clocked → ELR null (never divide by zero)", () => {
    const m = computeJobMargin([line("labour", 1, 65, null)], 0, 30);
    expect(m.effectiveLabourRate).toBeNull();
    expect(m.labourCost).toBe(0);
    expect(m.grossProfit).toBe(65);
  });

  it("empty job → zeros and nulls", () => {
    const m = computeJobMargin([], 0, null);
    expect(m.totalSell).toBe(0);
    expect(m.grossProfit).toBeNull();
    expect(m.partsMarginPct).toBeNull();
  });

  it("reconciles: GP + costs = total sell", () => {
    const lines = [line("part", 3, 40, 22), line("labour", 2, 70, null), line("other", 1, 15, null)];
    const m = computeJobMargin(lines, 150, 28);
    expect(m.grossProfit! + m.partsCost + m.labourCost!).toBeCloseTo(m.totalSell, 2);
  });
});

describe("aggregateMargins", () => {
  const job = (category: string, lines: MarginLine[], minutes: number): PeriodJob => ({
    lines,
    clockedMinutes: minutes,
    category,
  });

  it("sums jobs and groups by category, biggest sell first", () => {
    const agg = aggregateMargins(
      [
        job("Brakes", [line("part", 1, 100, 60), line("labour", 1, 65, null)], 60),
        job("Brakes", [line("labour", 2, 65, null)], 120),
        job("Servicing", [line("part", 1, 40, 25), line("labour", 3, 65, null)], 180),
      ],
      30,
    );
    expect(agg.jobs).toBe(3);
    expect(agg.sell).toBe(530); // 165 + 130 + 235
    expect(agg.clockedMinutes).toBe(360);
    expect(agg.labourCost).toBe(180); // 6h × 30
    expect(agg.effectiveLabourRate).toBe(65); // 390 labour / 6h
    expect(agg.grossProfit).toBe(265); // 530 − 85 parts − 180 labour
    expect(agg.byCategory.map((c) => c.category)).toEqual(["Brakes", "Servicing"]);
    expect(agg.byCategory[0].jobs).toBe(2);
    expect(agg.byCategory[0].grossProfit).toBe(145); // (165−60−30) + (130−60)
  });

  it("an uncosted part nulls period + category GP but not the sums", () => {
    const agg = aggregateMargins(
      [job("Tyres", [line("part", 1, 90, null)], 0), job("Brakes", [line("part", 1, 100, 60)], 0)],
      30,
    );
    expect(agg.unknownPartCostCount).toBe(1);
    expect(agg.grossProfit).toBeNull();
    expect(agg.byCategory.find((c) => c.category === "Tyres")!.grossProfit).toBeNull();
    expect(agg.byCategory.find((c) => c.category === "Brakes")!.grossProfit).toBe(40);
    expect(agg.sell).toBe(190);
  });

  it("empty period → zeros, pct null", () => {
    const agg = aggregateMargins([], 30);
    expect(agg.jobs).toBe(0);
    expect(agg.sell).toBe(0);
    expect(agg.grossProfit).toBe(0); // costs known (nothing unknown), just nothing sold
    expect(agg.grossMarginPct).toBeNull();
    expect(agg.effectiveLabourRate).toBeNull();
  });
});
