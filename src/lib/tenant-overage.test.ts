import { describe, expect, it } from "vitest";
import { overageQuantity } from "./tenant-overage";

describe("overageQuantity", () => {
  it("Growth meters above 7; never negative", () => {
    expect(overageQuantity("growth", 7)).toBe(0);
    expect(overageQuantity("growth", 8)).toBe(1);
    expect(overageQuantity("growth", 12)).toBe(5);
    expect(overageQuantity("growth", 3)).toBe(0);
  });

  it("non-Growth plans never meter", () => {
    expect(overageQuantity("pro", 10)).toBe(0);
    expect(overageQuantity("starter", 2)).toBe(0);
    expect(overageQuantity(null, 9)).toBe(0);
  });
});
