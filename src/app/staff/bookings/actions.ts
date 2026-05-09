"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";

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
  type: string;
  scheduledAt: string;
  registration: string | null;
}): Promise<{ email: boolean; sms: boolean }> {
  const { customerName, customerEmail, customerPhone, garageName, garagePhone, type, scheduledAt, registration } = args;
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

  const smsText = `Hi ${firstName}, your ${typeLabel} appointment${regSuffix} at ${garageName} is confirmed for ${dateStr}.${garagePhone ? ` Call ${garagePhone} to reschedule.` : ""}`;

  const result = { email: false, sms: false };

  if (customerEmail) {
    const emailResult = await sendEmail({
      to: customerEmail,
      subject: `Booking confirmed — ${typeLabel} at ${garageName}`,
      text: emailText,
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

  const [customerRes, vehicleRes, orgRes] = await Promise.all([
    admin.from("customers").select("id, full_name, email, phone, location_id").eq("id", customerId).maybeSingle(),
    vehicleId
      ? admin.from("vehicles").select("id, registration, customer_id, location_id").eq("id", vehicleId).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from("organizations").select("name, phone").eq("id", ctx.organization.id).maybeSingle(),
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
    .select("id, location_id, customer_id, vehicle_id, type, notes, status")
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
