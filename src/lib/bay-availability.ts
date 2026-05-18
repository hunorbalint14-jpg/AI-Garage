import { createAdminClient } from "@/lib/supabase/admin";

// Bookings that occupy a bay (don't block the bay if cancelled, complete, no-show).
const ACTIVE_STATUSES = ["scheduled", "in_progress", "payment_pending"] as const;

type OverlapRow = {
  id: string;
  bay_id: string | null;
  scheduled_at: string;
  duration_minutes: number;
};

function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

// Returns all active bookings at this location whose time window overlaps
// [scheduledAt, scheduledAt + durationMinutes). Caller filters/aggregates.
async function fetchOverlappingBookings(args: {
  locationId: string;
  scheduledAt: string;
  durationMinutes: number;
  excludeBookingId?: string | null;
}): Promise<OverlapRow[]> {
  const admin = createAdminClient();
  const newStart = new Date(args.scheduledAt).getTime();
  const newEnd = newStart + args.durationMinutes * 60_000;

  // Pull a generous window — any booking starting up to 8h before the new
  // start could still overlap with a long duration. Filter precisely in JS.
  const windowFromIso = new Date(newStart - 8 * 60 * 60_000).toISOString();
  const windowToIso = new Date(newEnd).toISOString();

  let query = admin
    .from("bookings")
    .select("id, bay_id, scheduled_at, duration_minutes")
    .eq("location_id", args.locationId)
    .in("status", ACTIVE_STATUSES as unknown as string[])
    .gte("scheduled_at", windowFromIso)
    .lt("scheduled_at", windowToIso);

  if (args.excludeBookingId) {
    query = query.neq("id", args.excludeBookingId);
  }

  const { data } = await query;
  const rows = (data ?? []) as OverlapRow[];

  return rows.filter((r) => {
    const rStart = new Date(r.scheduled_at).getTime();
    const rEnd = rStart + (r.duration_minutes ?? 60) * 60_000;
    return rangesOverlap(newStart, newEnd, rStart, rEnd);
  });
}

// True if the bay is free for the requested window. A null bay_id on an
// existing booking does not block the bay (it's unassigned).
export async function isBayFreeAt(args: {
  locationId: string;
  bayId: string;
  scheduledAt: string;
  durationMinutes: number;
  excludeBookingId?: string | null;
}): Promise<boolean> {
  const overlapping = await fetchOverlappingBookings({
    locationId: args.locationId,
    scheduledAt: args.scheduledAt,
    durationMinutes: args.durationMinutes,
    excludeBookingId: args.excludeBookingId,
  });
  return !overlapping.some((r) => r.bay_id === args.bayId);
}

// Capacity check: does the location have at least one bay free for this
// window? If the location has no bays defined at all we return `available:
// true` so legacy locations that don't manage bays keep working.
export async function bayCapacityAt(args: {
  locationId: string;
  scheduledAt: string;
  durationMinutes: number;
}): Promise<{
  available: boolean;
  totalBays: number;
  occupiedBays: number;
  freeBays: number;
}> {
  const admin = createAdminClient();
  const { count: totalBays } = await admin
    .from("bays")
    .select("id", { count: "exact", head: true })
    .eq("location_id", args.locationId);

  const bayCount = totalBays ?? 0;
  if (bayCount === 0) {
    return { available: true, totalBays: 0, occupiedBays: 0, freeBays: 0 };
  }

  const overlapping = await fetchOverlappingBookings({
    locationId: args.locationId,
    scheduledAt: args.scheduledAt,
    durationMinutes: args.durationMinutes,
  });
  const occupiedBayIds = new Set(
    overlapping.map((r) => r.bay_id).filter((id): id is string => !!id),
  );
  const occupied = occupiedBayIds.size;
  return {
    available: occupied < bayCount,
    totalBays: bayCount,
    occupiedBays: occupied,
    freeBays: bayCount - occupied,
  };
}
