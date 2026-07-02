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
  QUARTER_HOUR_OPTIONS,
  minuteOfLocalDateTime,
  instantMinuteOfDay,
  checkDateTimeWithinHours,
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
  it("exposes 96 quarter-hour options", () => {
    expect(QUARTER_HOUR_OPTIONS).toHaveLength(96);
    expect(QUARTER_HOUR_OPTIONS[0]).toEqual({ value: 0, label: "00:00" });
    expect(QUARTER_HOUR_OPTIONS.find((o) => o.value === 525)?.label).toBe("08:45");
  });
});

describe("minute helpers", () => {
  it("reads the minute-of-day from a naive local datetime", () => {
    expect(minuteOfLocalDateTime("2024-01-01T08:30")).toBe(510);
    expect(minuteOfLocalDateTime("2024-01-01T00:00")).toBe(0);
    expect(minuteOfLocalDateTime("2024-01-01 17:45:00")).toBe(1065);
  });
  it("returns null when there is no time part", () => {
    expect(minuteOfLocalDateTime("2024-01-01")).toBeNull();
    expect(minuteOfLocalDateTime("garbage")).toBeNull();
  });
  it("reads the minute-of-day of an instant in the garage timezone", () => {
    // Winter: UK = UTC.
    expect(instantMinuteOfDay("2024-01-01T09:30:00Z")).toBe(570);
    // Summer: UK = UTC+1, so 08:30Z is 09:30 in London.
    expect(instantMinuteOfDay("2024-07-01T08:30:00Z")).toBe(570);
  });
});

describe("checkDateTimeWithinHours", () => {
  const weekly: WeeklyHours = { 1: { open: 480, close: 1080 } }; // Mon 08:00–18:00

  it("is open for an in-hours time on an open day", () => {
    expect(checkDateTimeWithinHours(weekly, [], "2024-01-01T09:00")).toEqual({
      status: "open",
      hours: { open: 480, close: 1080 },
    });
  });
  it("flags a closed day", () => {
    expect(checkDateTimeWithinHours(weekly, [], "2024-01-02T09:00").status).toBe("closed_day");
  });
  it("flags an out-of-hours time on an open day", () => {
    expect(checkDateTimeWithinHours(weekly, [], "2024-01-01T07:59").status).toBe("outside_hours");
    expect(checkDateTimeWithinHours(weekly, [], "2024-01-01T18:00").status).toBe("outside_hours");
  });
  it("treats close as exclusive and open as inclusive", () => {
    expect(checkDateTimeWithinHours(weekly, [], "2024-01-01T08:00").status).toBe("open");
    expect(checkDateTimeWithinHours(weekly, [], "2024-01-01T17:59").status).toBe("open");
  });
  it("respects a custom special-hours override", () => {
    const custom: SpecialHours = { date: "2024-01-01", isClosed: false, openMinute: 600, closeMinute: 720 };
    expect(checkDateTimeWithinHours(weekly, [custom], "2024-01-01T09:00").status).toBe("outside_hours");
    expect(checkDateTimeWithinHours(weekly, [custom], "2024-01-01T10:30").status).toBe("open");
  });
  it("checks only the date when no time part is given", () => {
    expect(checkDateTimeWithinHours(weekly, [], "2024-01-01").status).toBe("open");
  });
});
