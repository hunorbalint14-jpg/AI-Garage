import { describe, it, expect } from "vitest";
import { isHvQualified, qualExpired, hvWarningFor } from "./ev-readiness";

describe("isHvQualified", () => {
  it("requires level 2 or above", () => {
    expect(isHvQualified(null)).toBe(false);
    expect(isHvQualified(0)).toBe(false);
    expect(isHvQualified(1)).toBe(false);
    expect(isHvQualified(2)).toBe(true);
    expect(isHvQualified(4)).toBe(true);
  });
});

describe("qualExpired", () => {
  const now = new Date("2026-06-14");
  it("treats no expiry as not expired", () => {
    expect(qualExpired(null, now)).toBe(false);
  });
  it("compares against now", () => {
    expect(qualExpired("2026-06-13", now)).toBe(true);
    expect(qualExpired("2026-06-15", now)).toBe(false);
  });
});

describe("hvWarningFor", () => {
  const base = {
    highVoltage: true,
    assigneeName: "Sam",
    assigneeLevel: 3,
    assigneeExpiresAt: null,
    locationHasQualified: true,
    now: new Date("2026-06-14"),
  };

  it("stays silent when not flagged", () => {
    expect(hvWarningFor({ ...base, highVoltage: false }).kind).toBe("none");
  });

  it("flags a location with zero qualified techs", () => {
    expect(hvWarningFor({ ...base, locationHasQualified: false }).kind).toBe("no_qualified_techs");
  });

  it("stays silent while unassigned (qualified techs exist)", () => {
    expect(hvWarningFor({ ...base, assigneeName: null }).kind).toBe("none");
  });

  it("flags an unqualified assignee", () => {
    const w = hvWarningFor({ ...base, assigneeLevel: 1 });
    expect(w).toEqual({ kind: "assignee_unqualified", assigneeName: "Sam" });
  });

  it("flags an expired qualification", () => {
    const w = hvWarningFor({ ...base, assigneeExpiresAt: "2026-01-01" });
    expect(w).toEqual({ kind: "assignee_expired", assigneeName: "Sam" });
  });

  it("passes a qualified, in-date assignee", () => {
    expect(hvWarningFor(base).kind).toBe("none");
  });
});
