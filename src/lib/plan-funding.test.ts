import { describe, it, expect } from "vitest";
import { decidePlanFunding, PLAN_FUNDING_RETRY_GRACE_MS } from "./plan-funding";

const base = {
  subId: "sub_123",
  amountPaid: 1999,
  rowExists: true,
  hasConnectedAccount: true,
  eventAgeMs: 0,
};

describe("decidePlanFunding", () => {
  it("accrues when the subscription row exists", () => {
    expect(decidePlanFunding(base)).toEqual({ action: "accrue", amountPence: 1999 });
  });

  it("skips when there is no subscription id", () => {
    expect(decidePlanFunding({ ...base, subId: null }).action).toBe("skip");
  });

  it("skips when nothing was paid", () => {
    expect(decidePlanFunding({ ...base, amountPaid: 0 }).action).toBe("skip");
    expect(decidePlanFunding({ ...base, amountPaid: -5 }).action).toBe("skip");
  });

  it("retries a connected-account invoice whose row hasn't been created yet (ordering race)", () => {
    const d = decidePlanFunding({ ...base, rowExists: false, hasConnectedAccount: true, eventAgeMs: 1000 });
    expect(d.action).toBe("retry");
  });

  it("does NOT retry a platform-account (tenant-billing) invoice with no row", () => {
    const d = decidePlanFunding({ ...base, rowExists: false, hasConnectedAccount: false, eventAgeMs: 1000 });
    expect(d).toEqual({ action: "skip", reason: "not-a-service-plan-invoice" });
  });

  it("gives up (skips, no retry) once the event is older than the grace window", () => {
    const d = decidePlanFunding({
      ...base,
      rowExists: false,
      hasConnectedAccount: true,
      eventAgeMs: PLAN_FUNDING_RETRY_GRACE_MS + 1,
    });
    expect(d).toEqual({ action: "skip", reason: "grace-expired-no-row" });
  });

  it("retries right up to the grace boundary, skips at/after it", () => {
    expect(decidePlanFunding({ ...base, rowExists: false, eventAgeMs: PLAN_FUNDING_RETRY_GRACE_MS - 1 }).action).toBe("retry");
    expect(decidePlanFunding({ ...base, rowExists: false, eventAgeMs: PLAN_FUNDING_RETRY_GRACE_MS }).action).toBe("skip");
  });

  it("prefers accrual over the race path when a row exists, regardless of age", () => {
    const d = decidePlanFunding({ ...base, rowExists: true, eventAgeMs: PLAN_FUNDING_RETRY_GRACE_MS * 10 });
    expect(d).toEqual({ action: "accrue", amountPence: 1999 });
  });
});
