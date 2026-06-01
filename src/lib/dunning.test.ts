import { describe, it, expect } from "vitest";
import { dunningStage, daysOverdue, DEFAULT_DUNNING_CADENCE } from "./dunning";

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
