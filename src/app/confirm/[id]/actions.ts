"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyBookingConfirmAccess } from "@/lib/booking-confirm";

// Public token-gated actions for the booking-confirmation page. The raw
// token from the link is re-verified on every call — possession of a valid
// link is the only credential.

export type ConfirmActionResult = { error: string } | { success: true };

export async function confirmBooking(bookingId: string, token: string): Promise<ConfirmActionResult> {
  const verify = await verifyBookingConfirmAccess(bookingId, token);
  if (!verify.ok) return { error: "This link is no longer valid." };
  if (verify.booking.confirmed_at) return { success: true };

  const admin = createAdminClient();
  const { error } = await admin
    .from("bookings")
    .update({ confirmed_at: new Date().toISOString(), reschedule_requested_at: null })
    .eq("id", bookingId);
  if (error) return { error: "Something went wrong — please try again." };

  revalidatePath(`/confirm/${bookingId}`);
  return { success: true };
}

export async function requestReschedule(bookingId: string, token: string): Promise<ConfirmActionResult> {
  const verify = await verifyBookingConfirmAccess(bookingId, token);
  if (!verify.ok) return { error: "This link is no longer valid." };
  if (verify.booking.reschedule_requested_at) return { success: true };

  const admin = createAdminClient();
  const { error } = await admin
    .from("bookings")
    .update({ reschedule_requested_at: new Date().toISOString(), confirmed_at: null })
    .eq("id", bookingId);
  if (error) return { error: "Something went wrong — please try again." };

  revalidatePath(`/confirm/${bookingId}`);
  return { success: true };
}
