import { describe, it, expect } from "vitest";
import {
  DEFAULT_BUSINESS_DAYS,
  normalizeBusinessDays,
  isOpenOn,
  weekdayOfLocalDate,
  weekdayOfInstant,
  formatBusinessDays,
} from "./business-days";

describe("normalizeBusinessDays", () => {
  it("dedupes, drops out-of-range values and orders Monday-first", () => {
    expect(normalizeBusinessDays([6, 1, 1, 0, 9, -1, 3])).toEqual([1, 3, 6, 0]);
  });

  it("accepts numeric strings (form values)", () => {
    expect(normalizeBusinessDays(["1", "2", "5"])).toEqual([1, 2, 5]);
  });

  it("falls back to the default week on empty/garbage input", () => {
    expect(normalizeBusinessDays([])).toEqual(DEFAULT_BUSINESS_DAYS);
    expect(normalizeBusinessDays(null)).toEqual(DEFAULT_BUSINESS_DAYS);
    expect(normalizeBusinessDays(["x", 99])).toEqual(DEFAULT_BUSINESS_DAYS);
  });
});

describe("isOpenOn", () => {
  it("reflects membership", () => {
    expect(isOpenOn([1, 2, 3, 4, 5, 6], 6)).toBe(true); // Saturday open
    expect(isOpenOn([1, 2, 3, 4, 5, 6], 0)).toBe(false); // Sunday closed
  });
});

describe("weekdayOfLocalDate", () => {
  it("returns the calendar weekday of a date string", () => {
    expect(weekdayOfLocalDate("2024-01-01")).toBe(1); // Monday
    expect(weekdayOfLocalDate("2024-01-07T09:30")).toBe(0); // Sunday (time ignored)
  });
});

describe("weekdayOfInstant", () => {
  it("evaluates the weekday in the garage timezone", () => {
    expect(weekdayOfInstant("2024-01-01T12:00:00Z")).toBe(1); // Monday in London
  });
});

describe("formatBusinessDays", () => {
  it("renders a contiguous run as a range", () => {
    expect(formatBusinessDays([1, 2, 3, 4, 5, 6])).toBe("Mon–Sat");
    expect(formatBusinessDays([1, 2, 3, 4, 5])).toBe("Mon–Fri");
  });

  it("renders a non-contiguous set as a list", () => {
    expect(formatBusinessDays([1, 3, 5])).toBe("Mon, Wed, Fri");
  });

  it("handles the edges", () => {
    expect(formatBusinessDays([])).toBe("Closed");
    expect(formatBusinessDays([0, 1, 2, 3, 4, 5, 6])).toBe("Every day");
    expect(formatBusinessDays([6])).toBe("Sat");
  });
});
