"use server";

// Public slot-availability reads (UX review F13 foundation). Callable without
// auth — the /book widget is anonymous — so inputs are validated hard and the
// response only ever contains availability booleans for one location. Mirrors
// how /book already reads hours: admin client behind the per-location cache.

import { createAdminClient } from "@/lib/supabase/admin";
import { cachedBays, cachedLocationHours } from "@/lib/location-cache";
import { ACTIVE_STATUSES } from "@/lib/bay-availability";
import { parseWeeklyHours, APP_TZ, type SpecialHours } from "@/lib/business-hours";
import { computeDaySlots, addDays, type SlotDay, type SlotBooking } from "@/lib/slots";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// How far ahead the pickers may look. Generous for MOT bookings, small enough
// to bound the anonymous query window.
const MAX_DAYS_AHEAD = 120;

function todayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: APP_TZ });
}

function validateInputs(locationId: string, dateISO: string, durationMinutes: number): void {
  if (!UUID_RE.test(locationId)) throw new Error("Invalid location");
  if (!DATE_RE.test(dateISO)) throw new Error("Invalid date");
  if (!Number.isFinite(durationMinutes) || durationMinutes < 5 || durationMinutes > 600) {
    throw new Error("Invalid duration");
  }
}

// Hours + bays + every active booking overlapping [start, start+days). One
// round of queries however many days the caller renders.
async function fetchSlotContext(locationId: string, startDate: string, days: number) {
  const [hours, bays] = await Promise.all([
    cachedLocationHours(locationId, todayKey()),
    cachedBays(locationId),
  ]);

  const admin = createAdminClient();
  // Any booking starting up to 8h before the window could still overlap into
  // it (same generous pre-window as bay-availability); precise per-slot
  // filtering happens in computeDaySlots.
  const windowFrom = new Date(new Date(`${startDate}T00:00`).getTime() - 8 * 60 * 60_000);
  const windowTo = new Date(`${addDays(startDate, days)}T00:00`);
  const { data } = await admin
    .from("bookings")
    .select("scheduled_at, duration_minutes, bay_id")
    .eq("location_id", locationId)
    .in("status", ACTIVE_STATUSES as unknown as string[])
    .gte("scheduled_at", windowFrom.toISOString())
    .lt("scheduled_at", windowTo.toISOString());

  return {
    weekly: parseWeeklyHours(hours.weekly),
    special: hours.special.map(
      (s): SpecialHours => ({
        date: s.date,
        isClosed: s.is_closed,
        openMinute: s.open_minute,
        closeMinute: s.close_minute,
      }),
    ),
    bayCount: bays.length,
    bookings: (data ?? []) as SlotBooking[],
  };
}

function clampToWindow(dateISO: string): { ok: boolean } {
  const today = todayKey();
  return { ok: dateISO >= today && dateISO <= addDays(today, MAX_DAYS_AHEAD) };
}

/** 30-min slot grid for one date. Out-of-window dates come back closed. */
export async function getAvailableSlots(
  locationId: string,
  dateISO: string,
  durationMinutes: number,
): Promise<SlotDay> {
  validateInputs(locationId, dateISO, durationMinutes);
  if (!clampToWindow(dateISO).ok) return { date: dateISO, open: false, slots: [] };
  const ctx = await fetchSlotContext(locationId, dateISO, 1);
  return computeDaySlots({ date: dateISO, durationMinutes, ...ctx });
}

/** Seven consecutive days from startDate — one fetch for a picker's week strip. */
export async function getAvailableSlotsWeek(
  locationId: string,
  startDateISO: string,
  durationMinutes: number,
): Promise<SlotDay[]> {
  validateInputs(locationId, startDateISO, durationMinutes);
  const ctx = await fetchSlotContext(locationId, startDateISO, 7);
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(startDateISO, i);
    if (!clampToWindow(date).ok) return { date, open: false, slots: [] } as SlotDay;
    return computeDaySlots({ date, durationMinutes, ...ctx });
  });
}
