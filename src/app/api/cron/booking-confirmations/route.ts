import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeEqual } from "@/lib/safe-equal";
import { recordCronRun } from "@/lib/platform/cron-runs";
import { sendEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import { sendWhatsApp } from "@/lib/whatsapp";
import {
  generateBookingConfirmToken,
  hashBookingConfirmToken,
  tenantBookingConfirmUrl,
} from "@/lib/booking-confirm";

export const maxDuration = 60;

// Booking no-show defence: T-24h confirmation messages. Dispatched per
// location by /api/cron/tick (task_type booking_confirmations). Finds
// tomorrow-ish scheduled bookings that haven't been messaged yet, mints a
// confirm token, and sends a one-tap confirm / reschedule link. Plain
// deterministic templates — this is transactional service comms (legitimate
// interest), not marketing, so no marketing-consent gate; contactability is
// the only requirement.

const HOURS_BEFORE_DEFAULT = 24;
// Don't message for bookings starting within the hour — too late to be useful.
const MIN_LEAD_MS = 60 * 60 * 1000;

type BookingRow = {
  id: string;
  scheduled_at: string;
  type: string;
  customer: { id: string; full_name: string | null; email: string | null; phone: string | null } | null;
  vehicle: { registration: string } | null;
};

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !safeEqual(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const locationId = request.nextUrl.searchParams.get("location_id");
  if (!locationId) return NextResponse.json({ error: "location_id required" }, { status: 400 });

  const admin = createAdminClient();
  const __t0 = Date.now();

  const [{ data: task }, { data: locationData }] = await Promise.all([
    admin
      .from("scheduled_tasks")
      .select("enabled, settings")
      .eq("location_id", locationId)
      .eq("task_type", "booking_confirmations")
      .maybeSingle(),
    admin
      .from("locations")
      .select("id, slug, name, organization:organizations(name)")
      .eq("id", locationId)
      .maybeSingle(),
  ]);

  if (task && task.enabled === false) {
    return NextResponse.json({ success: true, skipped: "disabled" });
  }
  const location = locationData as
    | { id: string; slug: string; name: string; organization: { name: string } | null }
    | null;
  if (!location) return NextResponse.json({ error: "location not found" }, { status: 404 });

  const settings = (task?.settings ?? {}) as { hours_before?: number; channels?: string[] };
  const hoursBefore = settings.hours_before ?? HOURS_BEFORE_DEFAULT;
  const channels = settings.channels ?? ["email", "sms", "whatsapp"];

  const now = new Date();
  const windowEnd = new Date(now.getTime() + (hoursBefore + 1) * 60 * 60 * 1000);

  const { data: bookingsData } = await admin
    .from("bookings")
    .select(
      "id, scheduled_at, type, customer:customers(id, full_name, email, phone), vehicle:vehicles(registration)",
    )
    .eq("location_id", locationId)
    .eq("status", "scheduled")
    .is("confirmation_sent_at", null)
    .gt("scheduled_at", new Date(now.getTime() + MIN_LEAD_MS).toISOString())
    .lte("scheduled_at", windowEnd.toISOString())
    .limit(100);

  const bookings = ((bookingsData ?? []) as unknown as BookingRow[]).filter((b) => b.customer);
  const garageName = location.organization?.name ?? location.name;

  let sent = 0;
  let skippedNoContact = 0;

  for (const booking of bookings) {
    const customer = booking.customer!;
    if (!customer.email && !customer.phone) {
      skippedNoContact++;
      continue;
    }

    const token = generateBookingConfirmToken();
    // Stamp before sending: a crashed run must not re-message the booking.
    const { error: stampError } = await admin
      .from("bookings")
      .update({
        confirm_token_hash: hashBookingConfirmToken(token),
        confirmation_sent_at: new Date().toISOString(),
      })
      .eq("id", booking.id)
      .is("confirmation_sent_at", null);
    if (stampError) continue;

    const confirmUrl = tenantBookingConfirmUrl(location.slug, booking.id, token);
    const firstName = customer.full_name?.split(" ")[0] ?? "there";
    const when = new Date(booking.scheduled_at).toLocaleString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });
    const vehicleBit = booking.vehicle?.registration ? ` for ${booking.vehicle.registration}` : "";
    const subject = `Please confirm your booking — ${when}`;
    const emailText = `Hi ${firstName},

A quick reminder of your booking${vehicleBit} at ${garageName} on ${when}.

Please tap the button below to confirm you're coming, or use the same link if you need to change the time. It only takes a second and helps us keep your slot ready.

See you soon!`;
    const smsText = `Hi ${firstName}, reminder: booking${vehicleBit} at ${garageName}, ${when}. Confirm or reschedule: ${confirmUrl}`;

    if (channels.includes("email") && customer.email) {
      const result = await sendEmail({
        to: customer.email,
        subject,
        text: emailText,
        cta: { url: confirmUrl, label: "Confirm booking" },
      });
      await admin.from("reminders").insert({
        location_id: locationId,
        customer_id: customer.id,
        vehicle_id: null,
        type: "custom",
        channel: "email",
        recipient_email: customer.email,
        recipient_phone: null,
        subject,
        message_text: emailText,
        status: result.success ? "sent" : "failed",
        error_message: result.success ? null : result.error,
        resend_email_id: result.success ? result.messageId : null,
      });
      if (result.success) sent++;
    }

    for (const channel of ["sms", "whatsapp"] as const) {
      if (!channels.includes(channel) || !customer.phone) continue;
      const send = channel === "sms" ? sendSms : sendWhatsApp;
      const result = await send({ to: customer.phone, body: smsText });
      await admin.from("reminders").insert({
        location_id: locationId,
        customer_id: customer.id,
        vehicle_id: null,
        type: "custom",
        channel,
        recipient_email: null,
        recipient_phone: customer.phone,
        subject,
        message_text: smsText,
        status: result.success ? "sent" : "failed",
        error_message: result.success ? null : result.error,
      });
      if (result.success) sent++;
    }
  }

  await recordCronRun(
    admin,
    "cron/booking-confirmations",
    true,
    Date.now() - __t0,
    `bookings ${bookings.length}, messages ${sent}, no contact ${skippedNoContact}`,
  );
  return NextResponse.json({
    success: true,
    bookings: bookings.length,
    messages_sent: sent,
    skipped_no_contact: skippedNoContact,
  });
}
