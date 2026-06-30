import { describe, it, expect } from "vitest";
import { candidateSlots, freeSlots, type SlotBooking } from "./slots";

describe("candidateSlots", () => {
  // Hours are minutes from midnight: 480 = 08:00, 1080 = 18:00.
  it("generates hourly slots within business hours", () => {
    const now = new Date("2026-06-15T06:00:00"); // before opening
    const slots = candidateSlots("2026-06-15", 480, 1080, now);
    expect(slots).toHaveLength(10); // 08..17
    expect(slots[0].getHours()).toBe(8);
    expect(slots[slots.length - 1].getHours()).toBe(17);
  });

  it("steps from a half-hour opening time", () => {
    const now = new Date("2026-06-15T06:00:00");
    const slots = candidateSlots("2026-06-15", 510, 750, now); // 08:30–12:30
    expect(slots.map((s) => `${s.getHours()}:${String(s.getMinutes()).padStart(2, "0")}`)).toEqual([
      "8:30",
      "9:30",
      "10:30",
      "11:30",
    ]);
  });

  it("skips past slots plus the lead time", () => {
    const now = new Date("2026-06-15T10:30:00");
    const slots = candidateSlots("2026-06-15", 480, 1080, now); // lead 60min → first 12:00
    expect(slots[0].getHours()).toBe(12);
  });

  it("returns empty for a fully past day", () => {
    const now = new Date("2026-06-16T09:00:00");
    expect(candidateSlots("2026-06-15", 480, 1080, now)).toHaveLength(0);
  });

  it("returns empty for garbage dates", () => {
    expect(candidateSlots("not-a-date", 480, 1080)).toHaveLength(0);
  });
});

describe("freeSlots", () => {
  const at = (h: number) => new Date(`2026-06-15T${String(h).padStart(2, "0")}:00:00`);
  const booking = (h: number, bay: string | null, mins = 60): SlotBooking => ({
    scheduled_at: at(h).toISOString(),
    duration_minutes: mins,
    bay_id: bay,
  });

  it("passes everything through when no bays are defined", () => {
    const candidates = [at(9), at(10)];
    expect(freeSlots(candidates, [booking(9, "b1")], 0)).toHaveLength(2);
  });

  it("blocks a slot when all bays are occupied", () => {
    const candidates = [at(9), at(10)];
    const out = freeSlots(candidates, [booking(9, "b1")], 1);
    expect(out.map((s) => s.getHours())).toEqual([10]);
  });

  it("keeps the slot when one of two bays is free", () => {
    const candidates = [at(9)];
    expect(freeSlots(candidates, [booking(9, "b1")], 2)).toHaveLength(1);
  });

  it("ignores bookings without a bay", () => {
    const candidates = [at(9)];
    expect(freeSlots(candidates, [booking(9, null)], 1)).toHaveLength(1);
  });

  it("respects long bookings spanning multiple slots", () => {
    const candidates = [at(9), at(10), at(11)];
    const out = freeSlots(candidates, [booking(9, "b1", 120)], 1);
    expect(out.map((s) => s.getHours())).toEqual([11]);
  });
});
