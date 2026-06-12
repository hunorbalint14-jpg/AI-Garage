// Pure slot maths for the receptionist's availability tool. No DB imports —
// the tool layer fetches bookings/bays once per day and feeds them in.

export type SlotBooking = {
  scheduled_at: string;
  duration_minutes: number;
  bay_id: string | null;
};

// Hourly candidate start times for a date within business hours, skipping
// anything in the past (with a small lead so the agent never offers "now").
export function candidateSlots(
  date: string, // YYYY-MM-DD
  businessHoursStart: number,
  businessHoursEnd: number,
  now: Date = new Date(),
  minLeadMinutes = 60,
): Date[] {
  const slots: Date[] = [];
  const earliest = now.getTime() + minLeadMinutes * 60_000;
  for (let hour = businessHoursStart; hour < businessHoursEnd; hour++) {
    const slot = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00`);
    if (isNaN(slot.getTime())) return [];
    if (slot.getTime() >= earliest) slots.push(slot);
  }
  return slots;
}

// Which candidate slots still have a free bay. Mirrors bay-availability.ts
// semantics: bookings without a bay don't block one; zero bays defined means
// the location doesn't manage capacity, so everything is available.
export function freeSlots(
  candidates: Date[],
  bookings: SlotBooking[],
  bayCount: number,
  durationMinutes = 60,
): Date[] {
  if (bayCount === 0) return candidates;
  return candidates.filter((slot) => {
    const start = slot.getTime();
    const end = start + durationMinutes * 60_000;
    const occupied = new Set<string>();
    for (const b of bookings) {
      if (!b.bay_id) continue;
      const bStart = new Date(b.scheduled_at).getTime();
      const bEnd = bStart + (b.duration_minutes ?? 60) * 60_000;
      if (start < bEnd && bStart < end) occupied.add(b.bay_id);
    }
    return occupied.size < bayCount;
  });
}

export function formatSlotLabel(slot: Date): string {
  return slot.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
