import { describe, expect, it } from "vitest";
import { parseMarkupRules, sellFromCost, marginPct, underTarget, DEFAULT_MARKUP_RULES } from "./parts-pricing";

describe("parseMarkupRules", () => {
  it("sorts finite bands ascending, catch-all last", () => {
    const rules = parseMarkupRules([
      { upToCost: null, multiplier: 1.5 },
      { upToCost: 50, multiplier: 1.8 },
      { upToCost: 10, multiplier: 2.2 },
    ]);
    expect(rules.map((b) => b.upToCost)).toEqual([10, 50, null]);
    expect(rules.map((b) => b.multiplier)).toEqual([2.2, 1.8, 1.5]);
  });

  it("drops malformed entries; empty/garbage → default", () => {
    expect(parseMarkupRules("nope")).toEqual(DEFAULT_MARKUP_RULES);
    expect(parseMarkupRules([{ upToCost: 10, multiplier: 0 }, { multiplier: -1 }])).toEqual(DEFAULT_MARKUP_RULES);
  });

  it("synthesises a catch-all from the top band when none given", () => {
    const rules = parseMarkupRules([{ upToCost: 20, multiplier: 2 }]);
    expect(rules[rules.length - 1]).toEqual({ upToCost: null, multiplier: 2 });
  });
});

describe("sellFromCost", () => {
  const rules = parseMarkupRules([
    { upToCost: 10, multiplier: 2.2 },
    { upToCost: 50, multiplier: 1.8 },
    { upToCost: null, multiplier: 1.5 },
  ]);
  it("picks the band by cost ceiling", () => {
    expect(sellFromCost(8, rules)).toBe(17.6); // ×2.2
    expect(sellFromCost(10, rules)).toBe(22); // inclusive ceiling
    expect(sellFromCost(40, rules)).toBe(72); // ×1.8
    expect(sellFromCost(200, rules)).toBe(300); // catch-all ×1.5
  });
  it("default rules when none passed; guards bad input", () => {
    expect(sellFromCost(100)).toBe(175);
    expect(sellFromCost(-5, rules)).toBe(0);
  });
});

describe("marginPct + underTarget", () => {
  it("margin on sell, null when unpriceable", () => {
    expect(marginPct(40, 72)).toBe(44);
    expect(marginPct(40, 0)).toBeNull();
  });
  it("under target only when a target is set and margin known", () => {
    expect(underTarget(44, 40)).toBe(false);
    expect(underTarget(37, 40)).toBe(true);
    expect(underTarget(null, 40)).toBe(false);
    expect(underTarget(10, null)).toBe(false);
  });
});
