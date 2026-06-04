import { describe, it, expect } from "vitest";
import { isLowStock } from "./inventory";

describe("isLowStock", () => {
  it("flags stock at or below the reorder threshold", () => {
    expect(isLowStock(2, 3)).toBe(true); // below
    expect(isLowStock(3, 3)).toBe(true); // at
    expect(isLowStock(0, 0)).toBe(true); // zero threshold, zero stock
  });

  it("does not flag stock above the threshold", () => {
    expect(isLowStock(4, 3)).toBe(false);
  });

  it("never flags when no threshold is set", () => {
    expect(isLowStock(0, null)).toBe(false);
    expect(isLowStock(100, null)).toBe(false);
  });
});
