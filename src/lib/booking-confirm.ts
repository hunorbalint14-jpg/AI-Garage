import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

// Booking confirmation token gating. The T-24h confirmation cron mints a
// random token per booking and stores only sha256(token); the /confirm/[id]
// page verifies the raw token from the link. Same pattern as quote-links.

export type BookingConfirmVerifyReason = "not_found" | "bad_token" | "wrong_status" | "past";

export type BookingConfirmRecord = {
  id: string;
  location_id: string;
  customer_id: string | null;
  vehicle_id: string | null;
  scheduled_at: string;
  duration_minutes: number;
  type: string;
  status: string;
  confirmed_at: string | null;
  reschedule_requested_at: string | null;
};

export type BookingConfirmVerifyResult =
  | { ok: true; booking: BookingConfirmRecord }
  | { ok: false; reason: BookingConfirmVerifyReason };

export function generateBookingConfirmToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashBookingConfirmToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function constantTimeEqualHex(a: string, b: string): boolean {
  try {
    const aBuf = Buffer.from(a, "hex");
    const bBuf = Buffer.from(b, "hex");
    if (aBuf.length !== bBuf.length || aBuf.length === 0) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

// Confirm links stay valid until the appointment itself has passed; statuses
// other than "scheduled" (cancelled, complete, …) make the page show its
// unavailable state rather than buttons.
export async function verifyBookingConfirmAccess(
  bookingId: string,
  rawToken: string | null,
): Promise<BookingConfirmVerifyResult> {
  if (!rawToken || rawToken.length < 16) return { ok: false, reason: "bad_token" };
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) return { ok: false, reason: "not_found" };

  const admin = createAdminClient();
  const { data } = await admin
    .from("bookings")
    .select(
      "id, location_id, customer_id, vehicle_id, scheduled_at, duration_minutes, type, status, confirm_token_hash, confirmed_at, reschedule_requested_at",
    )
    .eq("id", bookingId)
    .maybeSingle();

  if (!data) return { ok: false, reason: "not_found" };
  const row = data as BookingConfirmRecord & { confirm_token_hash: string | null };

  if (
    !row.confirm_token_hash ||
    !constantTimeEqualHex(hashBookingConfirmToken(rawToken), row.confirm_token_hash)
  ) {
    return { ok: false, reason: "bad_token" };
  }
  if (row.status !== "scheduled") return { ok: false, reason: "wrong_status" };
  if (new Date(row.scheduled_at) <= new Date()) return { ok: false, reason: "past" };

  return {
    ok: true,
    booking: {
      id: row.id,
      location_id: row.location_id,
      customer_id: row.customer_id,
      vehicle_id: row.vehicle_id,
      scheduled_at: row.scheduled_at,
      duration_minutes: row.duration_minutes,
      type: row.type,
      status: row.status,
      confirmed_at: row.confirmed_at,
      reschedule_requested_at: row.reschedule_requested_at,
    },
  };
}

// https://{tenant}.{root}/confirm/{bookingId}?t={token}
export function tenantBookingConfirmUrl(
  tenantSlug: string,
  bookingId: string,
  token: string,
): string {
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "ai-garage.co.uk";
  const isLocal = rootDomain.includes("localtest") || rootDomain.includes("localhost");
  const proto = isLocal ? "http" : "https";
  return `${proto}://${tenantSlug}.${rootDomain}/confirm/${bookingId}?t=${token}`;
}
