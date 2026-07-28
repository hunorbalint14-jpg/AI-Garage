"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { releaseCoverage } from "@/lib/service-plans";
import { checkCredit } from "@/lib/account";
import { sendEmail, tenantPortalUrl, renderBrandedEmail, paragraphsToHtml, type EmailDetailRow } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import { garageLabel, garageLocationBlock, garageLocationInline } from "@/lib/garage-identity";
import { isBayFreeAt } from "@/lib/bay-availability";
import { checkLocationHoursAt } from "@/lib/location-hours-check";
import { formatDayHours, formatWeeklySummary } from "@/lib/business-hours";
import { listLocationStaff } from "@/lib/staff-directory";
import { resolveVehicleHighVoltage } from "@/lib/vehicle-fuel";
import { serviceNetUnitPrice, vatRateFor, isVatTreatment } from "@/lib/vat";
import { logAudit } from "@/lib/audit";

export type BookingType = "mot" | "service" | "repair" | "diagnostic" | "other";
export type BookingStatus = "scheduled" | "in_progress" | "complete" | "cancelled" | "no_show";

export type CreateBookingResult =
  | { error: string }
  // Account credit control (#504): over-limit is a warning staff confirm
  // through (block mode requires owner/admin — the action refuses others).
  | { creditWarning: string }
  // Out-of-hours is a warning, not a refusal: the form shows it and re-submits
  // with confirmOutOfHours=1 when staff choose to create the booking anyway.
  | { outOfHours: string }
  | { success: true; bookingId: string };


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
  locationName: string | null;
  address: string | null;
  garagePhone: string | null;
  garageLogoUrl: string | null;
  manageUrl: string;
  type: string;
  scheduledAt: string;
  registration: string | null;
}): Promise<{ email: boolean; sms: boolean }> {
  const { customerName, customerEmail, customerPhone, garageName, locationName, address, garagePhone, garageLogoUrl, manageUrl, type, scheduledAt, registration } = args;
  const firstName = customerName.split(" ")[0] || "there";
  const dateStr = formatBookingDateTime(scheduledAt);
  const typeLabel = bookingTypeLabel(type);
  const regSuffix = registration ? ` for ${registration}` : "";
  // The branch the customer is booked into — named in every channel so they
  // know which site to attend (org name alone is ambiguous for multi-branch).
  const identity = { orgName: garageName, locationName, address };
  const where = garageLabel(identity);
  const locationBlock = garageLocationBlock(identity); // label + address, multi-line
  const addrLine = address?.trim() ? address.trim() : null;
  // Self-serve reschedule/cancel in the customer portal instead of "reply/call".
  const manageLine = `Need to reschedule or cancel? Manage your booking online: ${manageUrl}${garagePhone ? `\nOr call us on ${garagePhone}.` : ""}`;

  const emailText = `Hi ${firstName},

Your ${typeLabel} appointment${regSuffix} at ${where} is confirmed for ${dateStr}.

Location:
${locationBlock}

${manageLine}

Thank you,
${garageName}`;

  const details: EmailDetailRow[] = [
    { label: "When", value: dateStr },
    { label: "Where", value: addrLine ? `${where}\n${addrLine}` : where },
    ...(registration ? [{ label: "Vehicle", value: registration } as EmailDetailRow] : []),
    { label: "Service", value: typeLabel },
  ];
  const emailHtml = renderBrandedEmail({
    brandName: garageName,
    logoUrl: garageLogoUrl,
    badge: "Confirmed",
    heading: "Booking confirmed",
    bodyHtml: paragraphsToHtml(`Hi ${firstName},\n\nYour ${typeLabel} appointment${regSuffix} at ${where} is confirmed for ${dateStr}.`),
    details,
    cta: { url: manageUrl, label: "Manage booking" },
    footerNote: `Reschedule or cancel anytime${garagePhone ? ` · or call us on ${garagePhone}` : ""}.`,
  });

  const smsText = `Hi ${firstName}, your ${typeLabel} appointment${regSuffix} at ${garageLocationInline(identity)} is confirmed for ${dateStr}. Reschedule or cancel: ${manageUrl}`;

  const result = { email: false, sms: false };

  if (customerEmail) {
    const emailResult = await sendEmail({
      to: customerEmail,
      subject: `Booking confirmed — ${typeLabel} at ${where}`,
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
  // Set by convertQuoteToBooking: links the booking back to the source quote so
  // startBooking seeds the job with the quote's (approved) items.
  const fromQuoteId = (formData.get("fromQuoteId") as string | null)?.trim() || null;

  if (!customerId) return { error: "Customer is required." };
  if (!scheduledAt) return { error: "Date and time are required." };
  if (!type?.trim()) return { error: "Appointment type is required." };

  const duration = durationStr ? parseInt(durationStr, 10) : 60;
  if (Number.isNaN(duration) || duration < 15 || duration > 480) {
    return { error: "Duration must be between 15 and 480 minutes." };
  }

  // Account credit control (#504): warn (or block, per org setting) when the
  // account is over its limit. Staff confirm through a warning; block mode
  // only lets owners/admins proceed.
  if (formData.get("confirmCredit") !== "1") {
    const credit = await checkCredit(admin, customerId, ctx.organization.id);
    if (credit.state !== "ok") {
      const fmt = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
      const detail = `${fmt(credit.balance)} on account against a ${fmt(credit.limit)} limit`;
      const isManager = ctx.orgRole === "owner" || ctx.orgRole === "admin";
      if (credit.state === "block" && !isManager) {
        return { error: `Credit limit reached — ${detail}. An owner or admin must approve further work on account.` };
      }
      return { creditWarning: `${credit.state === "block" ? "Credit limit reached" : "Over credit limit"} — ${detail}.` };
    }
  }

  const isoScheduled = new Date(scheduledAt).toISOString();

  // Warn (but let staff confirm through) when the time falls on a closed day or
  // outside the branch's opening hours — staff may legitimately book early
  // drop-offs, but it shouldn't happen silently.
  if (formData.get("confirmOutOfHours") !== "1") {
    const hoursCheck = await checkLocationHoursAt(admin, ctx.location.id, ctx.location.name, scheduledAt);
    if (hoursCheck.status === "closed_day") {
      return {
        outOfHours: `${ctx.location.name} is closed that day (${formatWeeklySummary(hoursCheck.weekly)}).`,
      };
    }
    if (hoursCheck.status === "outside_hours") {
      return {
        outOfHours: `That time is outside ${ctx.location.name}'s opening hours — open ${formatDayHours(hoursCheck.hours!)} that day.`,
      };
    }
  }

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

  const [customerRes, vehicleRes, orgRes, serviceRes, locRes] = await Promise.all([
    admin.from("customers").select("id, full_name, email, phone, organization_id").eq("id", customerId).maybeSingle(),
    vehicleId
      ? admin.from("vehicles").select("id, registration, customer_id, organization_id").eq("id", vehicleId).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from("organizations").select("name, phone, logo_url").eq("id", ctx.organization.id).maybeSingle(),
    serviceId
      ? admin.from("services").select("id, location_id").eq("id", serviceId).maybeSingle()
      : Promise.resolve({ data: null }),
    // The active branch's address — printed in the confirmation so the customer
    // knows which site to attend (ctx.location already carries name + id).
    admin.from("locations").select("address").eq("id", ctx.location.id).maybeSingle(),
  ]);

  const locationAddress = (locRes.data as { address: string | null } | null)?.address ?? null;

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
      ...(fromQuoteId ? { from_quote_id: fromQuoteId } : {}),
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
      locationName: ctx.location.name,
      address: locationAddress,
      garagePhone: orgRes.data?.phone ?? null,
      garageLogoUrl: (orgRes.data as { logo_url?: string | null } | null)?.logo_url ?? null,
      manageUrl: tenantPortalUrl(ctx.organization.slug),
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
      .select("name, price, vat_included, vat_treatment")
      .eq("id", booking.service_id)
      .eq("location_id", ctx.location.id)
      .maybeSingle();
    if (service) {
      const svcTreatment = isVatTreatment(service.vat_treatment) ? service.vat_treatment : "standard";
      const svcRate = vatRateFor(svcTreatment);
      await admin.from("job_items").insert({
        job_id: job.id,
        description: service.name,
        type: "labour",
        quantity: 1,
        // Store net — the invoice adds VAT on top, and vat_included prices
        // are the advertised gross (see src/lib/vat.ts).
        unit_price: serviceNetUnitPrice(Number(service.price ?? 0), service.vat_included !== false, svcRate),
        service_id: booking.service_id,
        vat_rate: svcRate,
        vat_treatment: svcTreatment,
      });
    }
  }

  // If the booking came from a quote (declined-and-rebook, or an approved
  // quote converted to a booking), seed the new job with the quote's items so
  // the mechanic doesn't retype them. Partial approvals only carry the items
  // the customer actually ticked.
  if (fromQuoteId) {
    const [{ data: quoteRow }, { data: quoteItems }] = await Promise.all([
      admin.from("quotes").select("approved_item_ids").eq("id", fromQuoteId).maybeSingle(),
      admin
        .from("quote_items")
        .select("id, description, type, quantity, unit_price")
        .eq("quote_id", fromQuoteId)
        .order("sort_order"),
    ]);
    const approved = new Set(((quoteRow as { approved_item_ids: string[] | null } | null)?.approved_item_ids ?? []) as string[]);
    if (quoteItems && quoteItems.length > 0) {
      type QuoteItemRow = { id: string; description: string; type: string; quantity: number; unit_price: number };
      const rows = (quoteItems as QuoteItemRow[])
        .filter((it) => approved.size === 0 || approved.has(it.id))
        .map((it) => ({
          job_id: job.id,
          description: it.description,
          type: it.type,
          quantity: it.quantity,
          unit_price: it.unit_price,
          vat_treatment: "standard",
        }));
      if (rows.length > 0) await admin.from("job_items").insert(rows);
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

export type MoveBookingResult = { error: string } | { success: true };

// Drag-to-reschedule/resize from the shared bay timeline (UX review §1d
// follow-up, #491). One action moves time, bay and/or duration with the same
// guards the create/assign paths use. Time/bay changes need a still-scheduled
// booking; a duration resize is also allowed while work is in progress.
export async function moveBooking(args: {
  bookingId: string;
  /** Naive local "YYYY-MM-DDTHH:mm" — same shape createBooking accepts. */
  scheduledAt?: string;
  /** undefined = keep current bay; null = move to unassigned. */
  bayId?: string | null;
  durationMinutes?: number;
}): Promise<MoveBookingResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "bookings")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const { data } = await admin
    .from("bookings")
    .select("id, status, scheduled_at, duration_minutes, bay_id")
    .eq("id", args.bookingId)
    .eq("location_id", ctx.location.id)
    .maybeSingle();
  const booking = data as {
    id: string;
    status: string;
    scheduled_at: string;
    duration_minutes: number | null;
    bay_id: string | null;
  } | null;
  if (!booking) return { error: "Booking not found." };

  const movesTimeOrBay = args.scheduledAt !== undefined || args.bayId !== undefined;
  if (movesTimeOrBay && booking.status !== "scheduled") {
    return { error: "Only scheduled bookings can be moved." };
  }
  if (!movesTimeOrBay && booking.status !== "scheduled" && booking.status !== "in_progress") {
    return { error: "This booking can no longer be changed." };
  }

  const duration = args.durationMinutes ?? booking.duration_minutes ?? 60;
  if (!Number.isInteger(duration) || duration < 15 || duration > 720) {
    return { error: "Duration must be between 15 minutes and 12 hours." };
  }

  let scheduledIso = booking.scheduled_at;
  if (args.scheduledAt !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(args.scheduledAt)) {
      return { error: "Invalid date/time." };
    }
    const hoursCheck = await checkLocationHoursAt(admin, ctx.location.id, ctx.location.name, args.scheduledAt);
    if (hoursCheck.message) return { error: hoursCheck.message };
    scheduledIso = new Date(args.scheduledAt).toISOString();
  }

  const targetBay = args.bayId === undefined ? booking.bay_id : args.bayId;
  if (targetBay) {
    const { data: bay } = await admin
      .from("bays")
      .select("id")
      .eq("id", targetBay)
      .eq("location_id", ctx.location.id)
      .maybeSingle();
    if (!bay) return { error: "Bay not found at this location." };
    const free = await isBayFreeAt({
      locationId: ctx.location.id,
      bayId: targetBay,
      scheduledAt: scheduledIso,
      durationMinutes: duration,
      excludeBookingId: booking.id,
    });
    if (!free) return { error: "That bay is already booked for an overlapping time." };
  }

  const { error } = await admin
    .from("bookings")
    .update({ scheduled_at: scheduledIso, bay_id: targetBay, duration_minutes: duration })
    .eq("id", booking.id)
    .eq("location_id", ctx.location.id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    action: "booking.move",
    entityType: "booking",
    entityId: booking.id,
    metadata: {
      from: { scheduled_at: booking.scheduled_at, bay_id: booking.bay_id, duration_minutes: booking.duration_minutes },
      to: { scheduled_at: scheduledIso, bay_id: targetBay, duration_minutes: duration },
    },
  });

  revalidatePath("/staff/bookings");
  revalidatePath(`/staff/bookings/${booking.id}`);
  revalidatePath("/staff");
  return { success: true };
}
