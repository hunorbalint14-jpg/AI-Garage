import { describe, it, expect } from "vitest";
import { splitGross } from "./credit-notes";

describe("splitGross", () => {
  it("splits a gross refund into net + VAT at 20%", () => {
    // £120.00 gross at 20% → £100 net + £20 VAT
    expect(splitGross(12000, 20)).toEqual({ subtotal: 100, vat: 20, total: 120 });
  });

  it("handles a partial/odd amount with 2dp rounding", () => {
    const out = splitGross(5000, 20); // £50 gross
    expect(out.total).toBe(50);
    expect(out.subtotal).toBe(41.67);
    expect(out.vat).toBe(8.33);
    expect(out.subtotal + out.vat).toBeCloseTo(out.total, 2);
  });

  it("treats a zero VAT rate as all-net", () => {
    expect(splitGross(10000, 0)).toEqual({ subtotal: 100, vat: 0, total: 100 });
  });
});
