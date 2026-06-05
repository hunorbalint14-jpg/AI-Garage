import { describe, it, expect } from "vitest";
import {
  planPriceForInterval,
  subscriptionStatusLabel,
  isSubscriptionLive,
  computeMemberDiscount,
  applyInvoiceTotals,
  computeCoverage,
} from "./service-plans";

describe("planPriceForInterval", () => {
  const plan = {
    price_monthly_pence: 999,
    price_annual_pence: 9990,
    stripe_price_monthly_id: "price_m",
    stripe_price_annual_id: "price_y",
  };

  it("returns the monthly price + id", () => {
    expect(planPriceForInterval(plan, "month")).toEqual({ pence: 999, stripePriceId: "price_m" });
  });

  it("returns the annual price + id", () => {
    expect(planPriceForInterval(plan, "year")).toEqual({ pence: 9990, stripePriceId: "price_y" });
  });

  it("returns null when the interval isn't priced", () => {
    const monthlyOnly = {
      price_monthly_pence: null,
      price_annual_pence: 5000,
      stripe_price_monthly_id: null,
      stripe_price_annual_id: "p",
    };
    expect(planPriceForInterval(monthlyOnly, "month")).toBeNull();
    expect(planPriceForInterval(monthlyOnly, "year")).toEqual({ pence: 5000, stripePriceId: "p" });
  });
});

describe("subscriptionStatusLabel", () => {
  it("maps known statuses to friendly text", () => {
    expect(subscriptionStatusLabel("active")).toBe("Active");
    expect(subscriptionStatusLabel("past_due")).toBe("Payment overdue");
    expect(subscriptionStatusLabel("canceled")).toBe("Cancelled");
  });

  it("passes through an unknown status unchanged", () => {
    expect(subscriptionStatusLabel("weird")).toBe("weird");
  });
});

describe("isSubscriptionLive", () => {
  it("is true for active + trialing only", () => {
    expect(isSubscriptionLive("active")).toBe(true);
    expect(isSubscriptionLive("trialing")).toBe(true);
    expect(isSubscriptionLive("past_due")).toBe(false);
    expect(isSubscriptionLive("canceled")).toBe(false);
  });
});

describe("computeMemberDiscount", () => {
  it("returns 0 for none / non-positive / zero base", () => {
    expect(computeMemberDiscount(100, { type: "none", value: 0 })).toBe(0);
    expect(computeMemberDiscount(100, { type: "percent", value: 0 })).toBe(0);
    expect(computeMemberDiscount(0, { type: "percent", value: 10 })).toBe(0);
  });
  it("computes a percentage", () => {
    expect(computeMemberDiscount(100, { type: "percent", value: 10 })).toBe(10);
    expect(computeMemberDiscount(33.33, { type: "percent", value: 10 })).toBe(3.33);
  });
  it("applies a fixed amount, clamped to the base", () => {
    expect(computeMemberDiscount(100, { type: "fixed", value: 15 })).toBe(15);
    expect(computeMemberDiscount(100, { type: "fixed", value: 150 })).toBe(100);
  });
});

describe("applyInvoiceTotals", () => {
  it("charges VAT on the discounted net", () => {
    expect(applyInvoiceTotals({ subtotal: 100, discountAmount: 10, vatRate: 20 })).toEqual({
      vatAmount: 18,
      total: 108,
    });
    expect(applyInvoiceTotals({ subtotal: 100, discountAmount: 15, vatRate: 20 })).toEqual({
      vatAmount: 17,
      total: 102,
    });
  });
  it("with no discount equals the plain VAT calc", () => {
    expect(applyInvoiceTotals({ subtotal: 100, discountAmount: 0, vatRate: 20 })).toEqual({
      vatAmount: 20,
      total: 120,
    });
  });
});

describe("computeCoverage", () => {
  it("covers included lines up to the remaining allowance", () => {
    const lines = [
      { service_id: "mot", quantity: 1, unit_price: 40 },
      { service_id: "oil", quantity: 3, unit_price: 30 },
      { service_id: null, quantity: 2, unit_price: 10 }, // non-catalogue line
    ];
    const remaining = new Map([
      ["mot", 1],
      ["oil", 2],
    ]);
    const { coveredValue, perService } = computeCoverage(lines, remaining);
    // 1 MOT (£40) + 2 of 3 oil (£60) covered; the 3rd oil + the loose line aren't
    expect(coveredValue).toBe(100);
    expect(perService.get("mot")).toBe(1);
    expect(perService.get("oil")).toBe(2);
  });
  it("covers nothing when the allowance is exhausted or service not included", () => {
    const lines = [{ service_id: "oil", quantity: 2, unit_price: 30 }];
    expect(computeCoverage(lines, new Map([["oil", 0]])).coveredValue).toBe(0);
    expect(computeCoverage(lines, new Map()).coveredValue).toBe(0);
  });
});
