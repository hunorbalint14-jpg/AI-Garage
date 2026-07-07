// Bookable-slot computation for a branch: opening hours (weekly + special
// overrides) intersected with bay occupancy on a 30-minute grid. Pure logic —
// the getAvailableSlots/getAvailableSlotsWeek server actions in
// slots-actions.ts do the IO and feed this. Consumed by the customer portal's
// reschedule flow and the public booking widget (UX review F13).
//
// Time convention: slot times are naive garage wall-clock strings ("HH:mm" on
// a "YYYY-MM-DD"). Instants are built with `new Date("YYYY-MM-DDTHH:mm")` —
// the same server-local parse the booking submit path uses for scheduledAt
// (see src/app/book/actions.ts) — so slot occupancy and the final capacity
// guard agree with how bookings are actually stored.

import {
  resolveHoursForDate,
  formatDayHours,
  minutesToLabel,
  type WeeklyHours,
  type SpecialHours,
} from "@/lib/business-hours";

export const SLOT_STEP_MINUTES = 30;

export type Slot = { time: string; available: boolean };

export type SlotDay = {
  date: string; // "YYYY-MM-DD"
  open: boolean;
  openLabel?: string; // "08:00–18:00" when open
  slots: Slot[];
};

export type SlotBooking = {
  scheduled_at: string; // ISO instant as stored on bookings
  duration_minutes: number | null;
  bay_id: string | null;
};

// Instant (epoch ms) of a naive local date + minute-of-day, using the same
// parse rules as the booking submit path.
export function slotInstant(date: string, minute: number): number {
  return new Date(`${date}T${minutesToLabel(minute)}`).getTime();
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

// A slot is unavailable when every bay is occupied for the full service
// duration — mirroring bayCapacityAt (src/lib/bay-availability.ts): distinct
// assigned bays count as occupied, unassigned (null bay_id) bookings don't
// block, and a location with no bays defined never blocks.
function slotAvailable(
  start: number,
  durationMinutes: number,
  bookings: SlotBooking[],
  bayCount: number,
): boolean {
  if (bayCount === 0) return true;
  const end = start + durationMinutes * 60_000;
  const occupied = new Set<string>();
  for (const b of bookings) {
    if (!b.bay_id) continue;
    const bStart = new Date(b.scheduled_at).getTime();
    const bEnd = bStart + (b.duration_minutes ?? 60) * 60_000;
    if (rangesOverlap(start, end, bStart, bEnd)) occupied.add(b.bay_id);
  }
  return occupied.size < bayCount;
}

// One day's slot grid. `now` exists for tests; production callers omit it.
export function computeDaySlots(args: {
  date: string;
  weekly: WeeklyHours;
  special: SpecialHours[];
  bookings: SlotBooking[];
  bayCount: number;
  durationMinutes: number;
  now?: Date;
}): SlotDay {
  const { date, weekly, special, bookings, bayCount, durationMinutes } = args;
  const resolved = resolveHoursForDate(weekly, special, date);
  if (!resolved.open || !resolved.hours) {
    return { date, open: false, slots: [] };
  }

  const nowMs = (args.now ?? new Date()).getTime();
  const slots: Slot[] = [];
  // Slot must FIT before close: last start ≤ close − duration.
  for (
    let minute = resolved.hours.open;
    minute + durationMinutes <= resolved.hours.close;
    minute += SLOT_STEP_MINUTES
  ) {
    const start = slotInstant(date, minute);
    if (start <= nowMs) continue; // never offer past times (today)
    slots.push({
      time: minutesToLabel(minute),
      available: slotAvailable(start, durationMinutes, bookings, bayCount),
    });
  }

  return { date, open: true, openLabel: formatDayHours(resolved.hours), slots };
}

// "YYYY-MM-DD" + n days (calendar arithmetic on the date parts).
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, (d ?? 1) + days);
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${dt.getFullYear()}-${mm}-${dd}`;
}
