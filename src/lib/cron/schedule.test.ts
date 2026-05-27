import { describe, it, expect } from "vitest";
import { computeNextRunAt, formatSchedule } from "./schedule";

describe("computeNextRunAt (daily)", () => {
  it("schedules today when current time is before the target hour", () => {
    const from = new Date("2026-06-01T08:00:00Z");
    // hour: local hours, not UTC — use the same hour as `from` interpreted locally
    const next = computeNextRunAt("daily", from.getHours() + 1, null, from);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
    expect(next.getHours()).toBe(from.getHours() + 1);
    expect(next.getDate()).toBe(from.getDate());
  });

  it("rolls to tomorrow when target hour already passed today", () => {
    const from = new Date("2026-06-01T15:00:00");
    const next = computeNextRunAt("daily", from.getHours() - 1, null, from);
    expect(next.getDate()).toBe(from.getDate() + 1);
  });

  it("normalises minutes + seconds to 0", () => {
    const from = new Date("2026-06-01T08:45:33");
    const next = computeNextRunAt("daily", 10, null, from);
    expect(next.getMinutes()).toBe(0);
    expect(next.getSeconds()).toBe(0);
    expect(next.getMilliseconds()).toBe(0);
  });
});

describe("computeNextRunAt (weekly)", () => {
  it("schedules the next matching dayOfWeek", () => {
    // 2026-06-01 is a Monday (day 1). Ask for Friday (day 5).
    const from = new Date("2026-06-01T08:00:00");
    const next = computeNextRunAt("weekly", 9, 5, from);
    expect(next.getDay()).toBe(5);
    expect(next.getDate()).toBe(5); // 1 + 4 days
  });

  it("rolls forward 7 days when dayOfWeek matches today but hour passed", () => {
    const from = new Date("2026-06-01T15:00:00"); // Monday afternoon
    const next = computeNextRunAt("weekly", 9, 1, from);
    expect(next.getDay()).toBe(1);
    expect(next.getDate()).toBe(8); // next Monday
  });

  it("schedules today when dayOfWeek matches and hour is in the future", () => {
    const from = new Date("2026-06-01T08:00:00"); // Monday morning
    const next = computeNextRunAt("weekly", 15, 1, from);
    expect(next.getDay()).toBe(1);
    expect(next.getDate()).toBe(1);
  });
});

describe("formatSchedule", () => {
  it("daily", () => {
    expect(formatSchedule("daily", 9, null)).toBe("Daily at 09:00");
  });

  it("weekly with day", () => {
    expect(formatSchedule("weekly", 8, 1)).toBe("Weekly on Mon at 08:00");
  });

  it("weekly defaults to Mon when dayOfWeek is null", () => {
    expect(formatSchedule("weekly", 8, null)).toBe("Weekly on Mon at 08:00");
  });
});
