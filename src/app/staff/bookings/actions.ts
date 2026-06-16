"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { releaseCoverage } from "@/lib/service-plans";
import { sendEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import { isBayFreeAt } from "@/lib/bay-availability";
import { listLocationStaff } from "@/lib/staff-directory";
import { resolveVehicleHighVoltage } from "@/lib/vehicle-fuel";
import { logAudit } from "@/lib/audit";

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
  if (!hasPermission(ctx, "bookings")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const customerId = (formData.get("customerId") as string | null)?.trim();
  const vehicleId = (formData.get("vehicleId") as string | null)?.trim() || null;
  const bayId = (formData.get("bayId") as string | null)?.trim() || null;
  const scheduledAt = (formData.get("scheduledAt") as string | null)?.trim();
  const durationStr = (formData.get("durationMinutes") as string | null)?.trim();
  const type = (formData.get("type") as string | null)?.trim();
  const serviceId = (formData.get("serviceId") as string | null)?.trim() || null;
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

  const [customerRes, vehicleRes, orgRes, serviceRes] = await Promise.all([
    admin.from("customers").select("id, full_name, email, phone, organization_id").eq("id", customerId).maybeSingle(),
    vehicleId
      ? admin.from("vehicles").select("id, registration, customer_id, organization_id").eq("id", vehicleId).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from("organizations").select("name, phone, logo_url").eq("id", ctx.organization.id).maybeSingle(),
    serviceId
      ? admin.from("services").select("id, location_id").eq("id", serviceId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const customer = customerRes.data as { id: string; full_name: string | null; email: string | null; phone: string | null; organization_id: string } | null;
  if (!customer || customer.organization_id !== ctx.organization.id) {
    return { error: "Customer not found in this organisation." };
  }

  // Vehicles are customer-global (org-scoped); location_id is just the servicing
  // branch, not an access boundary. The picker lists the customer's vehicles
  // org-wide, so scope the check the same way: the vehicle must belong to the
  // selected customer (already org-verified above) and to this org — NOT to the
  // active branch, or booking a customer's vehicle from another branch 404s.
  const vehicle = vehicleRes.data as { id: string; registration: string; customer_id: string; organization_id: string } | null;
  if (vehicleId && (!vehicle || vehicle.customer_id !== customerId || vehicle.organization_id !== ctx.organization.id)) {
    return { error: "Vehicle not found for this customer." };
  }

  // Only carry through a service that belongs to this location; the picker may
  // submit a fallback type (e.g. "mot") that maps to no service row.
  const service = serviceRes.data as { id: string; location_id: string } | null;
  const validServiceId = service && service.location_id === ctx.location.id ? service.id : null;

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
      service_id: validServiceId,
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
  if (!hasPermission(ctx, "bookings")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const { data: booking, error: bookingFetchErr } = await admin
    .from("bookings")
    .select("id, location_id, customer_id, vehicle_id, service_id, assigned_to, type, notes, status")
    .eq("id", bookingId)
    .maybeSingle();

  if (bookingFetchErr) return { error: `Booking lookup failed: ${bookingFetchErr.message}` };
  if (!booking || booking.location_id !== ctx.location.id) return { error: "Booking not found." };

  // from_quote_id is a v2 column. Load it separately so that environments
  // that haven't run the v2 migration yet don't fail the whole select. Falls
  // back to null on any error (missing column, RLS, etc.).
  let fromQuoteId: string | null = null;
  try {
    const { data: extra } = await admin
      .from("bookings")
      .select("from_quote_id")
      .eq("id", bookingId)
      .maybeSingle();
    fromQuoteId = (extra as { from_quote_id: string | null } | null)?.from_quote_id ?? null;
  } catch {
    fromQuoteId = null;
  }
  if (booking.status === "complete" || booking.status === "cancelled") {
    return { error: `Booking is ${booking.status}.` };
  }

  // Create job linked to this booking. Carry over the booking's assigned
  // technician so staff don't have to reassign on the job — without this the
  // assignment is silently dropped on conversion (looked like assigning twice).
  const { data: job, error: jobErr } = await admin
    .from("jobs")
    .insert({
      location_id: ctx.location.id,
      customer_id: booking.customer_id,
      vehicle_id: booking.vehicle_id,
      booking_id: booking.id,
      assigned_to: booking.assigned_to,
      description: bookingTypeLabel(booking.type),
      notes: booking.notes,
    })
    .select("id")
    .single();

  if (jobErr) return { error: jobErr.message };

  // Auto-flag high voltage from the vehicle's DVLA fuel type (EV / hybrid).
  // Best-effort: a failed/again-unavailable lookup just leaves it unflagged,
  // and staff can still toggle it by hand on the job card.
  try {
    if (await resolveVehicleHighVoltage(admin, booking.vehicle_id)) {
      await admin.from("jobs").update({ high_voltage: true }).eq("id", job.id);
    }
  } catch (e) {
    console.error("[startBooking] HV auto-flag failed", e);
  }

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
        service_id: booking.service_id,
      });
    }
  }

  // If the booking was rebooked from a declined quote, also seed the new
  // job with the snapshot items so the mechanic doesn't retype them.
  if (fromQuoteId) {
    const { data: quoteItems } = await admin
      .from("job_quote_items")
      .select("description, type, quantity, unit_price")
      .eq("quote_id", fromQuoteId)
      .order("sort_order");
    if (quoteItems && quoteItems.length > 0) {
      type QuoteItemRow = { description: string; type: string; quantity: number; unit_price: number };
      const rows = (quoteItems as QuoteItemRow[]).map((it) => ({
        job_id: job.id,
        description: it.description,
        type: it.type,
        quantity: it.quantity,
        unit_price: it.unit_price,
      }));
      await admin.from("job_items").insert(rows);
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
  if (!hasPermission(ctx, "bookings")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const { error } = await admin
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("id", bookingId)
    .eq("location_id", ctx.location.id);

  if (error) return { error: error.message };
  await releaseCoverage(admin, bookingId);

  revalidatePath("/staff/bookings");
  revalidatePath(`/staff/bookings/${bookingId}`);
  revalidatePath("/staff");
  return { success: true };
}

export async function markNoShow(bookingId: string): Promise<UpdateBookingStatusResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "bookings")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const { error } = await admin
    .from("bookings")
    .update({ status: "no_show" })
    .eq("id", bookingId)
    .eq("location_id", ctx.location.id);

  if (error) return { error: error.message };
  await releaseCoverage(admin, bookingId);

  revalidatePath("/staff/bookings");
  revalidatePath(`/staff/bookings/${bookingId}`);
  revalidatePath("/staff");
  return { success: true };
}

export type ChargeNoShowResult = { error: string } | { success: true; amountPence: number };

// Charge the org's no-show fee against the card saved at booking time.
// Always a deliberate staff click — never automatic — and only possible once
// the booking is already marked no_show.
export async function chargeNoShowFee(bookingId: string): Promise<ChargeNoShowResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "bookings")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const [{ data: bookingData }, { data: orgData }] = await Promise.all([
    admin
      .from("bookings")
      .select(
        "id, status, stripe_customer_id, card_payment_method_id, card_on_file_at, no_show_charged_at, customer:customers(full_name)",
      )
      .eq("id", bookingId)
      .eq("location_id", ctx.location.id)
      .maybeSingle(),
    admin
      .from("organizations")
      .select(
        "no_show_fee_pence, stripe_account_id, stripe_charges_enabled, tenant_plan, tenant_subscription_status, tenant_current_period_end, tenant_trial_end",
      )
      .eq("id", ctx.organization.id)
      .maybeSingle(),
  ]);

  type BookingRow = {
    id: string;
    status: string;
    stripe_customer_id: string | null;
    card_payment_method_id: string | null;
    card_on_file_at: string | null;
    no_show_charged_at: string | null;
    customer: { full_name: string | null } | null;
  };
  type OrgRow = {
    no_show_fee_pence: number;
    stripe_account_id: string | null;
    stripe_charges_enabled: boolean | null;
    tenant_plan: string | null;
    tenant_subscription_status: string | null;
    tenant_current_period_end: string | null;
    tenant_trial_end: string | null;
  };
  const booking = bookingData as unknown as BookingRow | null;
  const org = orgData as OrgRow | null;

  if (!booking) return { error: "Booking not found." };
  if (booking.status !== "no_show") return { error: "Mark the booking as no-show first." };
  if (booking.no_show_charged_at) return { error: "The no-show fee was already charged." };
  if (!booking.stripe_customer_id || !booking.card_payment_method_id) {
    return { error: "No card on file for this booking." };
  }
  if (!org?.stripe_account_id || !org.stripe_charges_enabled) {
    return { error: "Stripe is not active for this organisation." };
  }
  const amountPence = Number(org.no_show_fee_pence) || 0;
  if (amountPence <= 0) return { error: "No-show fee is not configured in Settings." };

  const { stripe, platformFeePence } = await import("@/lib/stripe");
  const { effectiveFeePercent } = await import("@/lib/tenant-plans");

  try {
    const intent = await stripe.paymentIntents.create(
      {
        amount: amountPence,
        currency: "gbp",
        customer: booking.stripe_customer_id,
        payment_method: booking.card_payment_method_id,
        off_session: true,
        confirm: true,
        description: "No-show fee",
        application_fee_amount: platformFeePence(amountPence, effectiveFeePercent(org)),
        metadata: { booking_id: booking.id, kind: "no_show_fee" },
      },
      { stripeAccount: org.stripe_account_id },
    );

    await admin
      .from("bookings")
      .update({
        no_show_charge_intent_id: intent.id,
        no_show_charged_at: new Date().toISOString(),
        no_show_charge_amount_pence: amountPence,
        no_show_charge_error: null,
      })
      .eq("id", booking.id);

    await logAudit({
      organizationId: ctx.organization.id,
      action: "booking.no_show_charged",
      entityType: "booking",
      entityId: booking.id,
      metadata: { amount_pence: amountPence, payment_intent: intent.id },
    });

    revalidatePath(`/staff/bookings/${bookingId}`);
    return { success: true, amountPence };
  } catch (err) {
    // Declines (insufficient funds, expired/blocked card) land here — record
    // the failure so staff see why and can chase by other means.
    const message = err instanceof Error ? err.message : "Charge failed";
    await admin
      .from("bookings")
      .update({ no_show_charge_error: message.slice(0, 300) })
      .eq("id", booking.id);
    await logAudit({
      organizationId: ctx.organization.id,
      action: "booking.no_show_charge_failed",
      entityType: "booking",
      entityId: booking.id,
      metadata: { amount_pence: amountPence, error: message.slice(0, 200) },
    });
    revalidatePath(`/staff/bookings/${bookingId}`);
    return { error: `Charge failed: ${message}` };
  }
}

export type AssignBayResult = { error: string } | { success: true };

export async function assignBay(bookingId: string, bayId: string | null): Promise<AssignBayResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "bookings")) return { error: "Permission denied." };
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

export type AssignTechnicianResult = { error: string } | { success: true };

// Validate that a candidate assignee is actually staff at this location/org,
// so an owner can't assign a user from another tenant. Shared by booking + job.
async function isAssignableStaff(
  userId: string,
  locationId: string,
  organizationId: string,
): Promise<boolean> {
  const staff = await listLocationStaff(locationId, organizationId);
  return staff.some((s) => s.id === userId);
}

export async function assignBookingTechnician(
  bookingId: string,
  userId: string | null,
): Promise<AssignTechnicianResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "bookings")) return { error: "Permission denied." };
  const admin = createAdminClient();

  if (userId && !(await isAssignableStaff(userId, ctx.location.id, ctx.organization.id))) {
    return { error: "Staff member not found at this location." };
  }

  const { error } = await admin
    .from("bookings")
    .update({ assigned_to: userId })
    .eq("id", bookingId)
    .eq("location_id", ctx.location.id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "booking.assign",
    entityType: "booking",
    entityId: bookingId,
    metadata: { assigned_to: userId },
  });

  revalidatePath(`/staff/bookings/${bookingId}`);
  revalidatePath("/staff/bookings");
  revalidatePath("/staff");
  return { success: true };
}

export async function deleteBooking(bookingId: string): Promise<UpdateBookingStatusResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "bookings")) return { error: "Permission denied." };
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
