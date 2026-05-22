"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import { isBayFreeAt } from "@/lib/bay-availability";

export type BookingType = "mot" | "service" | "repair" | "diagnostic" | "other";
export type BookingStatus = "scheduled" | "in_progress" | "complete" | "cancelled" | "no_show";

export type CreateBookingResult = { error: string } | { success: true; bookingId: string };


function bookingTypeLabel(type: string): string {
  if (type === "mot") return "MOT";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function formatBookingDateTime(scheduledAt: string): string {
  return new Date(scheduledAt).toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function sendBookingConfirmation(args: {
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  garageName: string;
  garagePhone: string | null;
  garageLogoUrl: string | null;
  type: string;
  scheduledAt: string;
  registration: string | null;
}): Promise<{ email: boolean; sms: boolean }> {
  const { customerName, customerEmail, customerPhone, garageName, garagePhone, garageLogoUrl, type, scheduledAt, registration } = args;
  const firstName = customerName.split(" ")[0] || "there";
  const dateStr = formatBookingDateTime(scheduledAt);
  const typeLabel = bookingTypeLabel(type);
  const regSuffix = registration ? ` for ${registration}` : "";
  const contactLine = garagePhone
    ? `If you need to reschedule, call us on ${garagePhone} or reply to this email.`
    : `If you need to reschedule, please reply to this email.`;

  const emailText = `Hi ${firstName},

Your ${typeLabel} appointment${regSuffix} at ${garageName} is confirmed for ${dateStr}.

${contactLine}

Thank you,
${garageName}`;

  const emailHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.6;color:#111827;max-width:600px;margin:0 auto;padding:32px 24px">
${garageLogoUrl ? `<div style="margin-bottom:24px"><img src="${garageLogoUrl}" alt="${garageName}" style="max-height:48px;max-width:180px;object-fit:contain;display:block"></div>` : ""}
<p style="margin:0 0 16px 0">Hi ${firstName},</p>
<p style="margin:0 0 16px 0">Your <strong>${typeLabel}</strong> appointment${regSuffix} at <strong>${garageName}</strong> is confirmed for <strong>${dateStr}</strong>.</p>
<p style="margin:0 0 16px 0">${contactLine}</p>
<p style="margin:0 0 16px 0">Thank you,<br>${garageName}</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0">
<p style="font-size:12px;color:#9ca3af;margin:0">Sent via AI Garage</p>
</body></html>`;

  const smsText = `Hi ${firstName}, your ${typeLabel} appointment${regSuffix} at ${garageName} is confirmed for ${dateStr}.${garagePhone ? ` Call ${garagePhone} to reschedule.` : ""}`;

  const result = { email: false, sms: false };

  if (customerEmail) {
    const emailResult = await sendEmail({
      to: customerEmail,
      subject: `Booking confirmed — ${typeLabel} at ${garageName}`,
      text: emailText,
      html: emailHtml,
    });
    result.email = emailResult.success;
  }

  if (customerPhone) {
    const smsResult = await sendSms({ to: customerPhone, body: smsText });
    result.sms = smsResult.success;
  }

  return result;
}

export async function createBooking(formData: FormData): Promise<CreateBookingResult> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const customerId = (formData.get("customerId") as string | null)?.trim();
  const vehicleId = (formData.get("vehicleId") as string | null)?.trim() || null;
  const bayId = (formData.get("bayId") as string | null)?.trim() || null;
  const scheduledAt = (formData.get("scheduledAt") as string | null)?.trim();
  const durationStr = (formData.get("durationMinutes") as string | null)?.trim();
  const type = (formData.get("type") as string | null)?.trim();
  const notes = (formData.get("notes") as string | null)?.trim() || null;
  const sendConfirmation = formData.get("sendConfirmation") === "on";

  if (!customerId) return { error: "Customer is required." };
  if (!scheduledAt) return { error: "Date and time are required." };
  if (!type?.trim()) return { error: "Appointment type is required." };

  const duration = durationStr ? parseInt(durationStr, 10) : 60;
  if (Number.isNaN(duration) || duration < 15 || duration > 480) {
    return { error: "Duration must be between 15 and 480 minutes." };
  }

  const isoScheduled = new Date(scheduledAt).toISOString();

  // Reject double-booking on the same bay.
  if (bayId) {
    const free = await isBayFreeAt({
      locationId: ctx.location.id,
      bayId,
      scheduledAt: isoScheduled,
      durationMinutes: duration,
    });
    if (!free) {
      return { error: "That bay is already booked for an overlapping time. Pick a different bay or time." };
    }
  }

  const [customerRes, vehicleRes, orgRes] = await Promise.all([
    admin.from("customers").select("id, full_name, email, phone, location_id").eq("id", customerId).maybeSingle(),
    vehicleId
      ? admin.from("vehicles").select("id, registration, customer_id, location_id").eq("id", vehicleId).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from("organizations").select("name, phone, logo_url").eq("id", ctx.organization.id).maybeSingle(),
  ]);

  const customer = customerRes.data as { id: string; full_name: string | null; email: string | null; phone: string | null; location_id: string } | null;
  if (!customer || customer.location_id !== ctx.location.id) {
    return { error: "Customer not found at this location." };
  }

  const vehicle = vehicleRes.data as { id: string; registration: string; customer_id: string; location_id: string } | null;
  if (vehicleId && (!vehicle || vehicle.location_id !== ctx.location.id || vehicle.customer_id !== customerId)) {
    return { error: "Vehicle not found for this customer." };
  }

  const { data: booking, error } = await admin
    .from("bookings")
    .insert({
      location_id: ctx.location.id,
      customer_id: customerId,
      vehicle_id: vehicleId,
      bay_id: bayId || null,
      scheduled_at: isoScheduled,
      duration_minutes: duration,
      type,
      notes,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  if (sendConfirmation) {
    await sendBookingConfirmation({
      customerName: customer.full_name ?? "there",
      customerEmail: customer.email,
      customerPhone: customer.phone,
      garageName: orgRes.data?.name ?? ctx.organization.name,
      garagePhone: orgRes.data?.phone ?? null,
      garageLogoUrl: (orgRes.data as { logo_url?: string | null } | null)?.logo_url ?? null,
      type,
      scheduledAt: isoScheduled,
      registration: vehicle?.registration ?? null,
    });
  }

  revalidatePath("/staff/bookings");
  return { success: true, bookingId: booking.id };
}

export type UpdateBookingStatusResult = { error: string } | { success: true; jobId?: string };

export async function startBooking(bookingId: string): Promise<UpdateBookingStatusResult> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const { data: booking } = await admin
    .from("bookings")
    .select("id, location_id, customer_id, vehicle_id, service_id, type, notes, status")
    .eq("id", bookingId)
    .maybeSingle();

  if (!booking || booking.location_id !== ctx.location.id) return { error: "Booking not found." };
  if (booking.status === "complete" || booking.status === "cancelled") {
    return { error: `Booking is ${booking.status}.` };
  }

  // Create job linked to this booking
  const { data: job, error: jobErr } = await admin
    .from("jobs")
    .insert({
      location_id: ctx.location.id,
      customer_id: booking.customer_id,
      vehicle_id: booking.vehicle_id,
      booking_id: booking.id,
      description: bookingTypeLabel(booking.type),
      notes: booking.notes,
    })
    .select("id")
    .single();

  if (jobErr) return { error: jobErr.message };

  // Seed the job with a line item from the booked service so the
  // mechanic doesn't have to retype it. Only when the booking has a
  // service_id — older bookings made before service_id was wired up
  // skip this and just get an empty items list.
  if (booking.service_id) {
    const { data: service } = await admin
      .from("services")
      .select("name, price")
      .eq("id", booking.service_id)
      .eq("location_id", ctx.location.id)
      .maybeSingle();
    if (service) {
      await admin.from("job_items").insert({
        job_id: job.id,
        description: service.name,
        type: "labour",
        quantity: 1,
        unit_price: Number(service.price ?? 0),
      });
    }
  }

  const { error: bookingUpdateErr } = await admin
    .from("bookings")
    .update({ status: "in_progress" })
    .eq("id", bookingId);

  if (bookingUpdateErr) return { error: `Job created but booking status update failed: ${bookingUpdateErr.message}` };

  revalidatePath("/staff/bookings");
  revalidatePath(`/staff/bookings/${bookingId}`);
  revalidatePath("/staff");
  return { success: true, jobId: job.id };
}

export async function cancelBooking(bookingId: string): Promise<UpdateBookingStatusResult> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const { error } = await admin
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("id", bookingId)
    .eq("location_id", ctx.location.id);

  if (error) return { error: error.message };

  revalidatePath("/staff/bookings");
  revalidatePath(`/staff/bookings/${bookingId}`);
  revalidatePath("/staff");
  return { success: true };
}

export async function markNoShow(bookingId: string): Promise<UpdateBookingStatusResult> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const { error } = await admin
    .from("bookings")
    .update({ status: "no_show" })
    .eq("id", bookingId)
    .eq("location_id", ctx.location.id);

  if (error) return { error: error.message };

  revalidatePath("/staff/bookings");
  revalidatePath(`/staff/bookings/${bookingId}`);
  revalidatePath("/staff");
  return { success: true };
}

export type AssignBayResult = { error: string } | { success: true };

export async function assignBay(bookingId: string, bayId: string | null): Promise<AssignBayResult> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  if (bayId) {
    const { data: bay } = await admin
      .from("bays")
      .select("id")
      .eq("id", bayId)
      .eq("location_id", ctx.location.id)
      .maybeSingle();
    if (!bay) return { error: "Bay not found at this location." };

    // Load this booking's window to check overlap on the chosen bay.
    const { data: thisBooking } = await admin
      .from("bookings")
      .select("scheduled_at, duration_minutes")
      .eq("id", bookingId)
      .eq("location_id", ctx.location.id)
      .maybeSingle();
    if (!thisBooking) return { error: "Booking not found." };

    const free = await isBayFreeAt({
      locationId: ctx.location.id,
      bayId,
      scheduledAt: thisBooking.scheduled_at,
      durationMinutes: thisBooking.duration_minutes ?? 60,
      excludeBookingId: bookingId,
    });
    if (!free) {
      return { error: "That bay is already booked for an overlapping time." };
    }
  }

  const { error } = await admin
    .from("bookings")
    .update({ bay_id: bayId })
    .eq("id", bookingId)
    .eq("location_id", ctx.location.id);

  if (error) return { error: error.message };

  revalidatePath(`/staff/bookings/${bookingId}`);
  revalidatePath("/staff");
  return { success: true };
}

export async function deleteBooking(bookingId: string): Promise<UpdateBookingStatusResult> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const { error } = await admin
    .from("bookings")
    .delete()
    .eq("id", bookingId)
    .eq("location_id", ctx.location.id);

  if (error) return { error: error.message };

  revalidatePath("/staff/bookings");
  redirect("/staff/bookings");
}
