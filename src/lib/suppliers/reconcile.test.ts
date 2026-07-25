import { describe, it, expect } from "vitest";
import { reconcileConfirmation } from "./reconcile";
import type { ConfirmedLine } from "./types";

const line = (over: Partial<ConfirmedLine>): ConfirmedLine => ({
  sku: null,
  description: "part",
  quantity: 1,
  unitCost: 10,
  ...over,
});

describe("reconcileConfirmation", () => {
  it("matches on SKU first", () => {
    const { matches, unmatched } = reconcileConfirmation(
      [
        { id: "a", description: "Brake pads", sku: "BP-1188" },
        { id: "b", description: "Brake discs", sku: "BD-9921" },
      ],
      [line({ sku: "bd-9921", description: "totally different wording", unitCost: 42.5 })],
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].itemId).toBe("b");
    expect(matches[0].unitCost).toBe(42.5);
    expect(unmatched).toEqual([]);
  });

  it("finds a SKU typed into a free-text PO line", () => {
    const { matches } = reconcileConfirmation(
      [{ id: "a", description: "Oil filter OF-3321 (no stock link)", sku: null }],
      [line({ sku: "OF-3321", unitCost: 6.2 })],
    );
    expect(matches[0]).toMatchObject({ itemId: "a", unitCost: 6.2 });
  });

  it("falls back to description matching, exact before partial", () => {
    const { matches } = reconcileConfirmation(
      [
        { id: "a", description: "Brake pad set front", sku: null },
        { id: "b", description: "Brake pad set front axle - premium", sku: null },
      ],
      [line({ description: "brake pad set front", unitCost: 24 })],
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].itemId).toBe("a");
  });

  it("never matches one PO line twice", () => {
    const { matches, unmatched } = reconcileConfirmation(
      [{ id: "a", description: "Brake pad set", sku: null }],
      [line({ description: "Brake pad set", unitCost: 24 }), line({ description: "Brake pad set", unitCost: 26 })],
    );
    expect(matches).toHaveLength(1);
    expect(unmatched).toHaveLength(1);
  });

  it("reports lines it cannot place rather than guessing", () => {
    const { matches, unmatched } = reconcileConfirmation(
      [{ id: "a", description: "Brake pad set", sku: "BP-1" }],
      [line({ sku: "XX-999", description: "Screenwash 5L", unitCost: 4 })],
    );
    expect(matches).toEqual([]);
    expect(unmatched).toHaveLength(1);
  });

  it("does not let a loose text match steal a line another SKU matches", () => {
    // "Filter" would text-match item a, but line 1 owns it by SKU.
    const { matches } = reconcileConfirmation(
      [
        { id: "a", description: "Filter kit", sku: "FK-100" },
        { id: "b", description: "Filter", sku: null },
      ],
      [line({ description: "Filter", unitCost: 5 }), line({ sku: "FK-100", description: "Kit", unitCost: 30 })],
    );
    expect(matches.find((m) => m.itemId === "a")?.unitCost).toBe(30);
    expect(matches.find((m) => m.itemId === "b")?.unitCost).toBe(5);
  });
});
