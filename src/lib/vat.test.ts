import { describe, it, expect } from "vitest";
import {
  serviceNetUnitPrice,
  STANDARD_VAT_RATE,
  vatRateFor,
  computeInvoiceVat,
  isVatTreatment,
  isLikelyUkVatNumber,
  lineTreatmentOf,
} from "./vat";

describe("isLikelyUkVatNumber", () => {
  it("accepts standard 9-digit numbers with/without GB and spaces", () => {
    expect(isLikelyUkVatNumber("123456789")).toBe(true);
    expect(isLikelyUkVatNumber("GB123456789")).toBe(true);
    expect(isLikelyUkVatNumber("GB 123 4567 89")).toBe(true);
  });
  it("accepts 12-digit branch traders and GD/HA bodies", () => {
    expect(isLikelyUkVatNumber("123456789001")).toBe(true);
    expect(isLikelyUkVatNumber("GBGD001")).toBe(true);
    expect(isLikelyUkVatNumber("HA599")).toBe(true);
  });
  it("rejects wrong lengths and junk", () => {
    expect(isLikelyUkVatNumber("12345678")).toBe(false);
    expect(isLikelyUkVatNumber("1234567890")).toBe(false);
    expect(isLikelyUkVatNumber("VAT NUMBER")).toBe(false);
    expect(isLikelyUkVatNumber("")).toBe(false);
  });
});

describe("lineTreatmentOf", () => {
  it("prefers the stored treatment", () => {
    expect(lineTreatmentOf("zero", 0)).toBe("zero");
    expect(lineTreatmentOf("outside_scope", 0)).toBe("outside_scope");
  });
  it("legacy lines fall back by rate: positive → standard, 0 → outside_scope", () => {
    expect(lineTreatmentOf(null, 20)).toBe("standard");
    expect(lineTreatmentOf(undefined, null)).toBe("standard"); // null rate defaults 20
    expect(lineTreatmentOf("bogus", 0)).toBe("outside_scope");
  });
});

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
  it("a non-standard treatment means gross == net (rate 0)", () => {
    // MOT fee £54.85, vat_included, outside the scope: nothing to back out.
    expect(serviceNetUnitPrice(54.85, true, vatRateFor("outside_scope"))).toBe(54.85);
  });
});

describe("vatRateFor / isVatTreatment", () => {
  it("standard carries the standard rate, everything else 0", () => {
    expect(vatRateFor("standard")).toBe(20);
    expect(vatRateFor("zero")).toBe(0);
    expect(vatRateFor("exempt")).toBe(0);
    expect(vatRateFor("outside_scope")).toBe(0);
  });
  it("guards unknown treatments", () => {
    expect(isVatTreatment("standard")).toBe(true);
    expect(isVatTreatment("reduced")).toBe(false);
    expect(isVatTreatment(null)).toBe(false);
  });
});

describe("computeInvoiceVat", () => {
  it("charges VAT only on standard-rated lines", () => {
    // MOT £54.85 outside scope + labour £60 standard.
    const r = computeInvoiceVat(
      [
        { net: 54.85, quantity: 1, vatRate: 0 },
        { net: 60, quantity: 1, vatRate: 20 },
      ],
      0,
    );
    expect(r.vatAmount).toBe(12);
    // Blended: 12 / 114.85 ≈ 10.45%.
    expect(r.effectiveRate).toBeCloseTo(10.45, 2);
  });
  it("uniform 20% lines match the flat calculation", () => {
    const r = computeInvoiceVat([{ net: 100, quantity: 1, vatRate: 20 }], 0);
    expect(r).toEqual({ vatAmount: 20, effectiveRate: 20 });
  });
  it("applies deductions pro-rata across the VAT", () => {
    // £100 @ 20% with £10 discount → VAT on £90.
    const r = computeInvoiceVat([{ net: 100, quantity: 1, vatRate: 20 }], 10);
    expect(r).toEqual({ vatAmount: 18, effectiveRate: 20 });
  });
  it("fully-covered invoice carries no VAT", () => {
    const r = computeInvoiceVat([{ net: 50, quantity: 1, vatRate: 20 }], 50);
    expect(r).toEqual({ vatAmount: 0, effectiveRate: 0 });
  });
  it("empty lines are safe", () => {
    expect(computeInvoiceVat([], 0)).toEqual({ vatAmount: 0, effectiveRate: 0 });
  });
});
