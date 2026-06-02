import { describe, it, expect } from "vitest";
import { durationMinutes, labourEstimateMinutes, formatMinutes, liveActiveMinutes } from "./time-tracking";

describe("durationMinutes", () => {
  it("rounds to whole minutes", () => {
    expect(durationMinutes("2026-06-02T09:00:00Z", "2026-06-02T10:30:00Z")).toBe(90);
    expect(durationMinutes("2026-06-02T09:00:00Z", "2026-06-02T09:00:40Z")).toBe(1); // 40s → 1m
    expect(durationMinutes("2026-06-02T09:00:00Z", "2026-06-02T09:00:20Z")).toBe(0); // 20s → 0m
  });

  it("never returns negative for reversed/equal times", () => {
    expect(durationMinutes("2026-06-02T10:00:00Z", "2026-06-02T09:00:00Z")).toBe(0);
    expect(durationMinutes("2026-06-02T09:00:00Z", "2026-06-02T09:00:00Z")).toBe(0);
  });

  it("returns 0 for invalid input", () => {
    expect(durationMinutes("nope", "2026-06-02T09:00:00Z")).toBe(0);
  });
});

describe("labourEstimateMinutes", () => {
  it("sums labour-line hours × 60, ignoring parts/other", () => {
    expect(
      labourEstimateMinutes([
        { type: "labour", quantity: 1.5 },
        { type: "part", quantity: 4 },
        { type: "labour", quantity: 0.5 },
        { type: "other", quantity: 2 },
      ]),
    ).toBe(120);
  });

  it("returns 0 when there are no labour lines", () => {
    expect(labourEstimateMinutes([{ type: "part", quantity: 3 }])).toBe(0);
    expect(labourEstimateMinutes([])).toBe(0);
  });
});

describe("liveActiveMinutes", () => {
  const now = "2026-06-02T12:00:00Z";

  it("returns the stored duration for completed entries (override-aware)", () => {
    expect(
      liveActiveMinutes({ status: "completed", active_minutes: 300, segment_started_at: null, duration_minutes: 20 }, now),
    ).toBe(20);
  });

  it("adds the open segment to banked minutes for running entries", () => {
    expect(
      liveActiveMinutes({ status: "running", active_minutes: 15, segment_started_at: "2026-06-02T11:30:00Z", duration_minutes: null }, now),
    ).toBe(45); // 15 banked + 30 live
  });

  it("returns only banked minutes when paused", () => {
    expect(
      liveActiveMinutes({ status: "paused", active_minutes: 25, segment_started_at: null, duration_minutes: null }, now),
    ).toBe(25);
  });
});

describe("formatMinutes", () => {
  it("formats hours and minutes", () => {
    expect(formatMinutes(150)).toBe("2h 30m");
    expect(formatMinutes(120)).toBe("2h");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(0)).toBe("0m");
  });
});
