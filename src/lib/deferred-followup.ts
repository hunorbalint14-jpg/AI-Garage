import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

// Deferred-work follow-up sequence (#498, PR 3). Pure stage/grouping logic
// (unit-tested) + the book-it token gate. The cron route composes these; the
// booking widget resolves the token for prefill + recovery attribution.

export const DEFAULT_FOLLOWUP_DAYS = [14, 30];
/** A customer never gets two automated nags inside this window. */
export const FOLLOWUP_CAP_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export type FollowupRecord = {
  id: string;
  customer_id: string | null;
  vehicle_id: string | null;
  inspection_item_id: string | null;
  description: string;
  price: number | null;
  rag: "amber" | "red" | null;
  followup_count: number;
  last_followup_at: string | null;
  created_at: string;
};

// Which stage (1-based) is due for a record, or null. Stage N fires when the
// record has had N-1 follow-ups and is older than offsets[N-1] days. A record
// that missed several windows catches up with a single (its next) stage.
export function dueStage(
  record: Pick<FollowupRecord, "followup_count" | "created_at">,
  offsets: number[],
  now: Date = new Date(),
): number | null {
  const clean = offsets.filter((d) => Number.isInteger(d) && d > 0);
  if (record.followup_count >= clean.length) return null;
  const offset = clean[record.followup_count];
  const created = new Date(record.created_at).getTime();
  if (!Number.isFinite(created)) return null;
  return now.getTime() - created >= offset * DAY_MS ? record.followup_count + 1 : null;
}

export type FollowupBatch = {
  customerId: string;
  vehicleId: string | null;
  records: FollowupRecord[];
  stage: number;
};

// The batches to send this run: one message per (customer, vehicle), at most
// ONE batch per customer per run (oldest due vehicle first), skipping
// customers contacted — by this sequence or by any reminder — within the cap
// window. Records without a customer can't be contacted and are ignored.
export function groupDueRecords(
  records: FollowupRecord[],
  offsets: number[],
  recentlyContactedCustomerIds: Set<string>,
  now: Date = new Date(),
): FollowupBatch[] {
  const capMs = FOLLOWUP_CAP_DAYS * DAY_MS;

  // Customers with ANY record followed up inside the cap window are skipped
  // wholesale — last_followup_at is the sequence's own contact log.
  const cappedCustomers = new Set<string>();
  for (const r of records) {
    if (!r.customer_id || !r.last_followup_at) continue;
    if (now.getTime() - new Date(r.last_followup_at).getTime() < capMs) {
      cappedCustomers.add(r.customer_id);
    }
  }

  const byGroup = new Map<string, FollowupRecord[]>();
  for (const r of records) {
    if (!r.customer_id) continue;
    if (cappedCustomers.has(r.customer_id) || recentlyContactedCustomerIds.has(r.customer_id)) continue;
    if (dueStage(r, offsets, now) === null) continue;
    const key = `${r.customer_id}|${r.vehicle_id ?? "-"}`;
    byGroup.set(key, [...(byGroup.get(key) ?? []), r]);
  }

  // One batch per customer per run: the group with the oldest record wins;
  // the rest wait for a later run (the cap then spaces them out).
  const bestByCustomer = new Map<string, FollowupBatch>();
  for (const [key, group] of byGroup) {
    const customerId = key.split("|")[0];
    const vehicleId = group[0].vehicle_id;
    const oldest = Math.min(...group.map((r) => new Date(r.created_at).getTime()));
    const stage = Math.max(...group.map((r) => dueStage(r, offsets, now) ?? 1));
    const current = bestByCustomer.get(customerId);
    if (
      !current ||
      oldest < Math.min(...current.records.map((r) => new Date(r.created_at).getTime()))
    ) {
      bestByCustomer.set(customerId, { customerId, vehicleId, records: group, stage });
    }
  }
  return [...bestByCustomer.values()];
}

// ── Book-it token ────────────────────────────────────────────────────────────
// One token per sent message; sha256 stored on every record the message
// covered. /book?dw=<token> resolves it for prefill, and booking creation
// marks the covered records recovered.

export function generateDeferredBookToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashDeferredBookToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export type DeferredBookingContext = {
  recordIds: string[];
  locationId: string;
  items: { description: string; price: number | null }[];
  customer: { id: string; full_name: string | null; email: string | null; phone: string | null } | null;
  vehicle: { id: string; registration: string | null } | null;
};

export async function resolveDeferredBooking(
  admin: ReturnType<typeof createAdminClient>,
  rawToken: string | null,
): Promise<DeferredBookingContext | null> {
  if (!rawToken || rawToken.length < 16) return null;
  const hash = hashDeferredBookToken(rawToken);
  const { data } = await admin
    .from("deferred_work")
    .select(
      "id, location_id, description, price, status, customer:customers(id, full_name, email, phone), vehicle:vehicles(id, registration)",
    )
    .eq("book_token_hash", hash)
    .eq("status", "open")
    .limit(50);
  const rows = (data ?? []) as unknown as {
    id: string;
    location_id: string;
    description: string;
    price: number | null;
    status: string;
    customer: { id: string; full_name: string | null; email: string | null; phone: string | null } | null;
    vehicle: { id: string; registration: string | null } | null;
  }[];
  if (rows.length === 0) return null;
  return {
    recordIds: rows.map((r) => r.id),
    locationId: rows[0].location_id,
    items: rows.map((r) => ({ description: r.description, price: r.price })),
    customer: rows[0].customer,
    vehicle: rows[0].vehicle,
  };
}

// Mark every open record behind this token recovered by the given booking.
// Fire-safe: returns the count, never throws to the booking flow's caller.
export async function markDeferredRecovered(
  admin: ReturnType<typeof createAdminClient>,
  rawToken: string,
  bookingId: string,
): Promise<number> {
  const hash = hashDeferredBookToken(rawToken);
  const { data } = await admin
    .from("deferred_work")
    .update({
      status: "recovered",
      recovered_booking_id: bookingId,
      recovered_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("book_token_hash", hash)
    .eq("status", "open")
    .select("id");
  return (data ?? []).length;
}
