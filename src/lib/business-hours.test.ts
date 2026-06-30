import { describe, it, expect } from "vitest";
import {
  DEFAULT_WEEKLY_HOURS,
  parseWeeklyHours,
  weekdayOfLocalDate,
  weekdayOfInstant,
  resolveHoursForDate,
  minutesToLabel,
  formatDayHours,
  formatWeeklySummary,
  HALF_HOUR_OPTIONS,
  type WeeklyHours,
  type SpecialHours,
} from "./business-hours";

describe("parseWeeklyHours", () => {
  it("keeps valid weekday entries", () => {
    expect(parseWeeklyHours({ "1": { open: 480, close: 1080 }, "6": { open: 510, close: 750 } })).toEqual({
      1: { open: 480, close: 1080 },
      6: { open: 510, close: 750 },
    });
  });

  it("drops invalid weekdays and ranges", () => {
    const out = parseWeeklyHours({
      "1": { open: 480, close: 1080 },
      "9": { open: 0, close: 60 }, // bad weekday
      "2": { open: 600, close: 600 }, // open == close
      "3": { open: -1, close: 100 }, // out of range
    });
    expect(out).toEqual({ 1: { open: 480, close: 1080 } });
  });

  it("falls back to the default week on empty/garbage", () => {
    expect(parseWeeklyHours({})).toEqual(DEFAULT_WEEKLY_HOURS);
    expect(parseWeeklyHours(null)).toEqual(DEFAULT_WEEKLY_HOURS);
  });
});

describe("weekday helpers", () => {
  it("reads the calendar weekday of a date string", () => {
    expect(weekdayOfLocalDate("2024-01-01")).toBe(1); // Monday
    expect(weekdayOfLocalDate("2024-01-07T09:30")).toBe(0); // Sunday
  });
  it("reads the weekday of an instant in the garage timezone", () => {
    expect(weekdayOfInstant("2024-01-01T12:00:00Z")).toBe(1);
  });
});

describe("resolveHoursForDate", () => {
  const weekly: WeeklyHours = { 1: { open: 480, close: 1080 }, 6: { open: 510, close: 750 } };

  it("uses the weekday's regular hours", () => {
    expect(resolveHoursForDate(weekly, [], "2024-01-01")).toEqual({ open: true, hours: { open: 480, close: 1080 } });
  });
  it("treats an absent weekday as closed", () => {
    expect(resolveHoursForDate(weekly, [], "2024-01-07")).toEqual({ open: false, hours: null }); // Sunday
  });

  const closed: SpecialHours = { date: "2024-01-01", isClosed: true, openMinute: null, closeMinute: null };
  const custom: SpecialHours = { date: "2024-01-01", isClosed: false, openMinute: 600, closeMinute: 720 };

  it("lets a closed exception win over regular hours", () => {
    expect(resolveHoursForDate(weekly, [closed], "2024-01-01")).toEqual({ open: false, hours: null });
  });
  it("lets a custom exception win over regular hours", () => {
    expect(resolveHoursForDate(weekly, [custom], "2024-01-01")).toEqual({ open: true, hours: { open: 600, close: 720 } });
  });
  it("treats a malformed custom exception as closed", () => {
    const bad: SpecialHours = { date: "2024-01-01", isClosed: false, openMinute: 700, closeMinute: 600 };
    expect(resolveHoursForDate(weekly, [bad], "2024-01-01")).toEqual({ open: false, hours: null });
  });
});

describe("formatting", () => {
  it("labels minutes", () => {
    expect(minutesToLabel(510)).toBe("08:30");
    expect(minutesToLabel(0)).toBe("00:00");
  });
  it("formats a day's hours", () => {
    expect(formatDayHours({ open: 510, close: 750 })).toBe("08:30–12:30");
  });
  it("groups a weekly summary Monday-first", () => {
    const weekly: WeeklyHours = {
      1: { open: 480, close: 1080 },
      2: { open: 480, close: 1080 },
      3: { open: 480, close: 1080 },
      4: { open: 480, close: 1080 },
      5: { open: 480, close: 1080 },
      6: { open: 510, close: 750 },
    };
    expect(formatWeeklySummary(weekly)).toBe("Mon–Fri 08:00–18:00, Sat 08:30–12:30, Sun closed");
  });
  it("exposes 48 half-hour options", () => {
    expect(HALF_HOUR_OPTIONS).toHaveLength(48);
    expect(HALF_HOUR_OPTIONS[0]).toEqual({ value: 0, label: "00:00" });
    expect(HALF_HOUR_OPTIONS.find((o) => o.value === 510)?.label).toBe("08:30");
  });
});
