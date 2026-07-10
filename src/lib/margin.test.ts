import { describe, expect, it } from "vitest";
import { computeJobMargin, type MarginLine } from "./margin";

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
