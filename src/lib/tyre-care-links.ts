import crypto from "node:crypto";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { Evidence, ServiceType } from "@/lib/tyre-care";

// Tyre-care booking link (#596 PR 5): /book?tc=<token>. One token per sent
// message; only the sha256 is stored on the recommendation. The booking page
// resolves it for prefill, and booking creation marks the recommendation
// converted. The token dies when the row leaves `approved_sent`.

type Admin = ReturnType<typeof createAdminClient>;

/** 128-bit, like the unsubscribe token — both ride in the same text message. */
export function generateTyreCareBookToken(): string {
  return crypto.randomBytes(16).toString("base64url");
}

export function hashTyreCareBookToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export type TyreCareBookingContext = {
  recommendationId: string;
  locationId: string;
  serviceType: ServiceType;
  reason: string;
  customer: { id: string; full_name: string | null; email: string | null; phone: string | null } | null;
  vehicle: { id: string; registration: string | null } | null;
};

export async function resolveTyreCareBooking(
  admin: Admin,
  rawToken: string | null,
): Promise<TyreCareBookingContext | null> {
  if (!rawToken || rawToken.length < 16) return null;
  const { data } = await admin
    .from("tyre_recommendations")
    .select(
      "id, location_id, service_type, evidence, customer:customers(id, full_name, email, phone), vehicle:vehicles(id, registration)",
    )
    .eq("book_token_hash", hashTyreCareBookToken(rawToken))
    .eq("status", "approved_sent")
    .maybeSingle();
  const row = data as unknown as {
    id: string;
    location_id: string;
    service_type: ServiceType;
    evidence: Evidence;
    customer: TyreCareBookingContext["customer"];
    vehicle: TyreCareBookingContext["vehicle"];
  } | null;
  if (!row) return null;
  return {
    recommendationId: row.id,
    locationId: row.location_id,
    serviceType: row.service_type,
    reason: row.evidence?.reason ?? "",
    customer: row.customer,
    vehicle: row.vehicle,
  };
}

/**
 * Attribute a booking to the recommendation that prompted it. Returns the
 * recommendation id, or null when the token is unknown or already spent.
 */
export async function markTyreRecConverted(admin: Admin, rawToken: string, bookingId: string): Promise<string | null> {
  const nowIso = new Date().toISOString();
  const { data } = await admin
    .from("tyre_recommendations")
    .update({ status: "converted", converted_booking_id: bookingId, converted_at: nowIso, updated_at: nowIso })
    .eq("book_token_hash", hashTyreCareBookToken(rawToken))
    .eq("status", "approved_sent")
    .select("id");
  return (data as { id: string }[] | null)?.[0]?.id ?? null;
}
