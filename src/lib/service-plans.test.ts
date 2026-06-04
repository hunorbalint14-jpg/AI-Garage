import { describe, it, expect } from "vitest";
import { planPriceForInterval, subscriptionStatusLabel, isSubscriptionLive } from "./service-plans";

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
