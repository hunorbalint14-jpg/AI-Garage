import { describe, it, expect } from "vitest";
import { evaluateCoverage, computeCancellationRefund, type PlanState } from "./service-plans";

function state(over: Partial<PlanState> = {}): PlanState {
  return {
    subscriptionId: "sub_1",
    planName: "Gold",
    currentPeriodEnd: "2027-01-01T00:00:00Z",
    benefitsStartAt: null,
    paidInPence: 10000,
    valueDrawnPence: 0,
    discount: null,
    remaining: new Map([["svc_mot", 1]]),
    ...over,
  };
}
const mot = { id: "svc_mot", pricePence: 5500 };

describe("evaluateCoverage", () => {
  it("no live plan → full price", () => {
    expect(evaluateCoverage(null, mot)).toEqual({ kind: "full" });
  });

  it("covered when in bundle + funded + allowance + past gate + has period", () => {
    expect(evaluateCoverage(state(), mot).kind).toBe("covered");
  });

  it("not funded → plan discount (or full when no discount)", () => {
    expect(
      evaluateCoverage(state({ paidInPence: 1000, discount: { type: "percent", value: 10 } }), mot).kind,
    ).toBe("discount");
    expect(evaluateCoverage(state({ paidInPence: 1000, discount: null }), mot).kind).toBe("full");
  });

  it("funding gate counts value already drawn", () => {
    // paid 10000, drawn 5000, MOT 5500 → 5000+5500 > 10000 → not funded.
    expect(evaluateCoverage(state({ valueDrawnPence: 5000, discount: null }), mot).kind).toBe("full");
    // drawn 4000 → 4000+5500 < 10000 → funded.
    expect(evaluateCoverage(state({ valueDrawnPence: 4000 }), mot).kind).toBe("covered");
  });

  it("allowance exhausted → discount/full, not covered", () => {
    expect(
      evaluateCoverage(state({ remaining: new Map([["svc_mot", 0]]), discount: { type: "fixed", value: 5 } }), mot).kind,
    ).toBe("discount");
  });

  it("service not in the bundle → not covered", () => {
    expect(evaluateCoverage(state(), { id: "svc_other", pricePence: 5500 }).kind).toBe("full");
  });

  it("before benefits_start_at (onboarding gate) → not covered", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(evaluateCoverage(state({ benefitsStartAt: future }), mot).kind).toBe("full");
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(evaluateCoverage(state({ benefitsStartAt: past }), mot).kind).toBe("covered");
  });

  it("no current billing period → not coverable", () => {
    expect(evaluateCoverage(state({ currentPeriodEnd: null }), mot).kind).toBe("full");
  });
});

describe("computeCancellationRefund", () => {
  it("unspent = paid-in − value-drawn, clamped ≥ 0", () => {
    expect(computeCancellationRefund(state({ paidInPence: 10000, valueDrawnPence: 3000 }))).toBe(7000);
    expect(computeCancellationRefund(state({ paidInPence: 2000, valueDrawnPence: 9000 }))).toBe(0);
  });
});
