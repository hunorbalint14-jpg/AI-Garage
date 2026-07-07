import { describe, it, expect } from "vitest";
import { computeDaySlots, addDays, slotInstant, type SlotBooking } from "./slots";
import type { WeeklyHours, SpecialHours } from "./business-hours";

// Mon–Fri 09:00–12:00 keeps grids small (6 half-hour marks, 09:00–11:30).
const weekly: WeeklyHours = {
  1: { open: 540, close: 720 },
  2: { open: 540, close: 720 },
  3: { open: 540, close: 720 },
  4: { open: 540, close: 720 },
  5: { open: 540, close: 720 },
};

// 2024-01-01 was a Monday. `past` pins "now" before every test date so no
// slot is dropped as already-elapsed unless a test wants it.
const MON = "2024-01-01";
const past = new Date("2020-01-01T00:00:00");

// Bookings are built with the same wall-time parse the module uses, so tests
// pass in any runner timezone.
function booking(date: string, minute: number, durationMinutes: number, bayId: string | null): SlotBooking {
  return {
    scheduled_at: new Date(slotInstant(date, minute)).toISOString(),
    duration_minutes: durationMinutes,
    bay_id: bayId,
  };
}

describe("computeDaySlots", () => {
  it("builds a 30-min grid within hours; every slot fits before close", () => {
    const day = computeDaySlots({
      date: MON, weekly, special: [], bookings: [], bayCount: 2, durationMinutes: 60, now: past,
    });
    expect(day.open).toBe(true);
    expect(day.openLabel).toBe("09:00–12:00");
    // 60-min service: last start 11:00, not 11:30.
    expect(day.slots.map((s) => s.time)).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00"]);
    expect(day.slots.every((s) => s.available)).toBe(true);
  });

  it("returns closed for a day with no weekly hours", () => {
    const sunday = "2024-01-07";
    const day = computeDaySlots({
      date: sunday, weekly, special: [], bookings: [], bayCount: 2, durationMinutes: 30, now: past,
    });
    expect(day).toEqual({ date: sunday, open: false, slots: [] });
  });

  it("special-hours override wins: closed date", () => {
    const special: SpecialHours[] = [{ date: MON, isClosed: true, openMinute: null, closeMinute: null }];
    const day = computeDaySlots({
      date: MON, weekly, special, bookings: [], bayCount: 2, durationMinutes: 30, now: past,
    });
    expect(day.open).toBe(false);
  });

  it("special-hours override wins: custom hours", () => {
    const special: SpecialHours[] = [{ date: MON, isClosed: false, openMinute: 600, closeMinute: 660 }];
    const day = computeDaySlots({
      date: MON, weekly, special, bookings: [], bayCount: 1, durationMinutes: 30, now: past,
    });
    expect(day.openLabel).toBe("10:00–11:00");
    expect(day.slots.map((s) => s.time)).toEqual(["10:00", "10:30"]);
  });

  it("marks a slot unavailable when all bays are occupied for the full duration", () => {
    // Both bays busy 09:30–10:30 → the 60-min 09:00/09:30/10:00 starts all overlap.
    const bookings = [booking(MON, 570, 60, "bay-1"), booking(MON, 570, 60, "bay-2")];
    const day = computeDaySlots({
      date: MON, weekly, special: [], bookings, bayCount: 2, durationMinutes: 60, now: past,
    });
    expect(day.slots).toEqual([
      { time: "09:00", available: false },
      { time: "09:30", available: false },
      { time: "10:00", available: false },
      { time: "10:30", available: true },
      { time: "11:00", available: true },
    ]);
  });

  it("one free bay keeps the slot available; unassigned bookings never block", () => {
    const bookings = [booking(MON, 540, 180, "bay-1"), booking(MON, 540, 180, null)];
    const day = computeDaySlots({
      date: MON, weekly, special: [], bookings, bayCount: 2, durationMinutes: 30, now: past,
    });
    expect(day.slots.every((s) => s.available)).toBe(true);
  });

  it("a location with no bays never blocks (legacy behaviour)", () => {
    const bookings = [booking(MON, 540, 600, "bay-1")];
    const day = computeDaySlots({
      date: MON, weekly, special: [], bookings, bayCount: 0, durationMinutes: 30, now: past,
    });
    expect(day.slots.every((s) => s.available)).toBe(true);
  });

  it("excludes past times for today", () => {
    // "Now" = 10:05 on the test Monday → 09:00/09:30/10:00 starts are gone.
    const now = new Date(slotInstant(MON, 605));
    const day = computeDaySlots({
      date: MON, weekly, special: [], bookings: [], bayCount: 1, durationMinutes: 30, now,
    });
    expect(day.slots.map((s) => s.time)).toEqual(["10:30", "11:00", "11:30"]);
  });
});

describe("addDays", () => {
  it("does calendar arithmetic across month/year ends", () => {
    expect(addDays("2024-01-01", 6)).toBe("2024-01-07");
    expect(addDays("2024-01-31", 1)).toBe("2024-02-01");
    expect(addDays("2024-12-31", 1)).toBe("2025-01-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29"); // leap year
  });
});
