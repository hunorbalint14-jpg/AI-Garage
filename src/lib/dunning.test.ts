import { describe, it, expect } from "vitest";
import { dunningStage, daysOverdue, daysSinceLastDunning, stageGapDays, DEFAULT_DUNNING_CADENCE } from "./dunning";

describe("dunningStage", () => {
  it("does not send before the first threshold", () => {
    expect(dunningStage(0, 0)).toEqual({ send: false, stage: 0 });
  });

  it("sends stage 1 at 1 day overdue", () => {
    expect(dunningStage(1, 0)).toEqual({ send: true, stage: 1 });
    expect(dunningStage(5, 0)).toEqual({ send: true, stage: 1 });
  });

  it("holds at stage 1 until the 7-day threshold", () => {
    expect(dunningStage(3, 1)).toEqual({ send: false, stage: 1 });
  });

  it("sends stage 2 at 7 days, stage 3 at 14 days", () => {
    expect(dunningStage(7, 1)).toEqual({ send: true, stage: 2 });
    expect(dunningStage(20, 2)).toEqual({ send: true, stage: 3 });
  });

  it("caps at cadence.length (no fourth reminder)", () => {
    expect(dunningStage(100, 3)).toEqual({ send: false, stage: 3 });
    expect(dunningStage(100, 3, DEFAULT_DUNNING_CADENCE)).toEqual({ send: false, stage: 3 });
  });

  it("respects a custom cadence", () => {
    expect(dunningStage(2, 0, [3, 10])).toEqual({ send: false, stage: 0 });
    expect(dunningStage(3, 0, [3, 10])).toEqual({ send: true, stage: 1 });
    expect(dunningStage(10, 1, [3, 10])).toEqual({ send: true, stage: 2 });
    expect(dunningStage(99, 2, [3, 10])).toEqual({ send: false, stage: 2 });
  });
});

describe("daysOverdue", () => {
  const now = new Date("2026-06-10T12:00:00Z");

  it("is 0 on the due date and negative before it", () => {
    expect(daysOverdue("2026-06-10T00:00:00Z", now)).toBe(0);
    expect(daysOverdue("2026-06-15T00:00:00Z", now)).toBeLessThan(0);
  });

  it("counts whole days past the due date", () => {
    expect(daysOverdue("2026-06-09T12:00:00Z", now)).toBe(1);
    expect(daysOverdue("2026-06-03T12:00:00Z", now)).toBe(7);
  });
});

describe("dunningStage spacing", () => {
  it("sends stage 1 straight away for an old debt", () => {
    expect(dunningStage(80, 0, DEFAULT_DUNNING_CADENCE, null)).toEqual({ send: true, stage: 1 });
  });

  it("waits the cadence gap before stage 2 even when long past its threshold", () => {
    // Stage 1 went yesterday on an invoice 80 days overdue: [1,7,14] → 6-day gap.
    expect(dunningStage(81, 1, DEFAULT_DUNNING_CADENCE, 1)).toEqual({ send: false, stage: 1 });
    expect(dunningStage(85, 1, DEFAULT_DUNNING_CADENCE, 5)).toEqual({ send: false, stage: 1 });
    expect(dunningStage(86, 1, DEFAULT_DUNNING_CADENCE, 6)).toEqual({ send: true, stage: 2 });
  });

  it("waits 7 days between stage 2 and the final stage", () => {
    expect(dunningStage(92, 2, DEFAULT_DUNNING_CADENCE, 6)).toEqual({ send: false, stage: 2 });
    expect(dunningStage(93, 2, DEFAULT_DUNNING_CADENCE, 7)).toEqual({ send: true, stage: 3 });
  });

  it("changes nothing for an invoice dunned on time", () => {
    // Stage 1 at 1 day overdue, stage 2 due at 7 days — 6 days later.
    expect(dunningStage(7, 1, DEFAULT_DUNNING_CADENCE, 6)).toEqual({ send: true, stage: 2 });
    // Stage 3 at 14 days — 7 days after stage 2.
    expect(dunningStage(14, 2, DEFAULT_DUNNING_CADENCE, 7)).toEqual({ send: true, stage: 3 });
  });

  it("treats a non-increasing custom cadence as at least a day apart", () => {
    expect(stageGapDays(1, [5, 5, 5])).toBe(1);
    expect(dunningStage(30, 1, [5, 5, 5], 0)).toEqual({ send: false, stage: 1 });
    expect(dunningStage(30, 1, [5, 5, 5], 1)).toEqual({ send: true, stage: 2 });
  });

  it("uses the gap from the cadence itself", () => {
    expect(stageGapDays(0)).toBe(0);
    expect(stageGapDays(1)).toBe(6);
    expect(stageGapDays(2)).toBe(7);
    expect(stageGapDays(1, [3, 10])).toBe(7);
  });
});

describe("daysSinceLastDunning", () => {
  it("counts UTC calendar days, so cron jitter doesn't slip a day", () => {
    // Sent at 09:00:05, checked a week later at 09:00:02 — still 7 days.
    expect(daysSinceLastDunning("2026-09-29T09:00:05Z", new Date("2026-10-06T09:00:02Z"))).toBe(7);
    expect(daysSinceLastDunning("2026-09-29T23:59:00Z", new Date("2026-09-30T00:01:00Z"))).toBe(1);
    expect(daysSinceLastDunning("2026-09-29T09:00:00Z", new Date("2026-09-29T18:00:00Z"))).toBe(0);
  });

  it("is null when nothing was sent", () => {
    expect(daysSinceLastDunning(null)).toBeNull();
    expect(daysSinceLastDunning("not a date")).toBeNull();
  });
});
