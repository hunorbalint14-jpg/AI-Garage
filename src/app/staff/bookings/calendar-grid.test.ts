import { describe, it, expect } from "vitest";
import {
  parseMonthParam,
  toMonthParam,
  addMonths,
  buildMonthGrid,
  dayKey,
  instantDayKey,
  formatMonthLabel,
} from "./calendar-grid";

describe("parseMonthParam", () => {
  it("parses a valid YYYY-MM", () => {
    expect(parseMonthParam("2026-06")).toEqual({ year: 2026, month: 5 });
  });
  it("falls back to current month on garbage/missing", () => {
    const now = new Date(2026, 2, 15); // March 2026
    expect(parseMonthParam(undefined, now)).toEqual({ year: 2026, month: 2 });
    expect(parseMonthParam("nope", now)).toEqual({ year: 2026, month: 2 });
    expect(parseMonthParam("2026-13", now)).toEqual({ year: 2026, month: 2 });
  });
});

describe("toMonthParam", () => {
  it("zero-pads the month", () => {
    expect(toMonthParam(2026, 0)).toBe("2026-01");
    expect(toMonthParam(2026, 11)).toBe("2026-12");
  });
});

describe("addMonths", () => {
  it("wraps Dec -> Jan of next year", () => {
    expect(addMonths(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
  });
  it("wraps Jan -> Dec of previous year", () => {
    expect(addMonths(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
  });
});

describe("buildMonthGrid", () => {
  it("returns 42 cells starting on a Monday", () => {
    const grid = buildMonthGrid(2026, 5); // June 2026
    expect(grid).toHaveLength(42);
    expect(grid[0].getDay()).toBe(1); // Monday
  });

  it("includes every day of the target month", () => {
    const grid = buildMonthGrid(2026, 5); // June: 30 days
    const keys = new Set(grid.map(dayKey));
    for (let d = 1; d <= 30; d++) {
      expect(keys.has(`2026-06-${String(d).padStart(2, "0")}`)).toBe(true);
    }
  });

  it("pads with adjacent-month days (June 2026 starts Monday 1st)", () => {
    // 1 Jun 2026 is a Monday, so the grid leads with late May and trails July.
    const grid = buildMonthGrid(2026, 5);
    expect(dayKey(grid[0])).toBe("2026-06-01");
    expect(dayKey(grid[41])).toBe("2026-07-12");
  });

  it("leads with previous-month days when the 1st is not Monday", () => {
    // 1 Mar 2026 is a Sunday → grid[0] should be Mon 23 Feb 2026.
    const grid = buildMonthGrid(2026, 2);
    expect(dayKey(grid[0])).toBe("2026-02-23");
    expect(grid[0].getDay()).toBe(1);
  });
});

describe("dayKey", () => {
  it("formats local YYYY-MM-DD", () => {
    expect(dayKey(new Date(2026, 5, 9))).toBe("2026-06-09");
    expect(dayKey(new Date(2026, 11, 25))).toBe("2026-12-25");
  });
});

describe("instantDayKey (Europe/London)", () => {
  it("rolls a late-evening summer (BST) instant into the next London day", () => {
    // 23:30Z on 8 Jun = 00:30 BST on 9 Jun.
    expect(instantDayKey("2026-06-08T23:30:00Z")).toBe("2026-06-09");
  });
  it("keeps a winter (GMT) instant on the same day", () => {
    expect(instantDayKey("2026-01-08T23:30:00Z")).toBe("2026-01-08");
  });
  it("is stable regardless of the host timezone (matches grid keys)", () => {
    expect(instantDayKey("2026-06-09T10:00:00Z")).toBe("2026-06-09");
  });
});

describe("formatMonthLabel", () => {
  it("renders month + year", () => {
    expect(formatMonthLabel(2026, 5)).toBe("June 2026");
  });
});
