import { describe, it, expect } from "vitest";
import { serviceNetUnitPrice, STANDARD_VAT_RATE } from "./vat";

describe("serviceNetUnitPrice", () => {
  it("backs VAT out of a gross (vat_included) price", () => {
    expect(serviceNetUnitPrice(120, true)).toBe(100);
    expect(serviceNetUnitPrice(54.85, true)).toBe(45.71);
  });
  it("gross price + exclusive invoice VAT round-trips to the advertised price", () => {
    // The invariant the fix restores: net * 1.2 ≈ the advertised gross.
    const net = serviceNetUnitPrice(54.85, true);
    expect(Math.abs(net * (1 + STANDARD_VAT_RATE / 100) - 54.85)).toBeLessThan(0.01);
  });
  it("leaves an exclusive (vat_included=false) price untouched", () => {
    expect(serviceNetUnitPrice(100, false)).toBe(100);
  });
  it("handles zero / invalid prices", () => {
    expect(serviceNetUnitPrice(0, true)).toBe(0);
    expect(serviceNetUnitPrice(Number.NaN, true)).toBe(0);
  });
});
