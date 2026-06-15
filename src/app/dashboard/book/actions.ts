"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import { stripe, platformFeePence, tenantOrigin } from "@/lib/stripe";
import { effectiveFeePercent } from "@/lib/tenant-plans";
import { bayCapacityAt } from "@/lib/bay-availability";
import {
  getCustomerPlanState,
  evaluateCoverage,
  reserveCoverage,
  computeMemberDiscount,
} from "@/lib/service-plans";

export type BookingRequestResult =
  | { error: string }
  | { success: true; paymentUrl?: string };

export async function requestBooking(formData: FormData): Promise<BookingRequestResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const headersList = await headers();
  const slug = headersList.get("x-tenant-slug");
  if (!slug) return { error: "Garage not found." };

  const admin = createAdminClient();

  const { data: locationRow } = await admin
    .from("locations")
    .select(
      "id, name, organization:organizations(id, name, phone, stripe_account_id, stripe_charges_enabled, tenant_plan, tenant_subscription_status, tenant_current_period_end, tenant_trial_end)",
    )
    .eq("slug", slug)
    .maybeSingle();

  const location = locationRow as {
    id: string;
    name: string;
    organization: {
      id: string;
      name: string;
      phone: string | null;
      stripe_account_id: string | null;
      stripe_charges_enabled: boolean | null;
      tenant_plan: string | null;
      tenant_subscription_status: string | null;
      tenant_current_period_end: string | null;
      tenant_trial_end: string | null;
    } | null;
  } | null;
  if (!location) return { error: "Location not found." };
  if (!location.organization) return { error: "Garage not found." };

  // Customers are org-scoped (registered once per org); resolve by organization,
  // not by the branch the booking is being made at.
  let { data: customer } = await admin
    .from("customers")
    .select("id, full_name, email, phone")
    .eq("organization_id", location.organization.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!customer) {
    // Fallback: match by email and link the user_id.
    const { data: byEmail } = await admin
      .from("customers")
      .select("id, full_name, email, phone")
      .eq("organization_id", location.organization.id)
      .eq("email", user.email ?? "")
      .maybeSingle();
    if (!byEmail) return { error: "Customer record not found." };
    await admin.from("customers").update({ user_id: user.id }).eq("id", byEmail.id);
    customer = byEmail;
  }

  const cust = customer as { id: string; full_name: string | null; email: string | null; phone: string | null };

  const vehicleId = (formData.get("vehicleId") as string | null)?.trim() || null;
  const serviceIdInput = (formData.get("serviceId") as string | null)?.trim() || null;
  const scheduledAt = (formData.get("scheduledAt") as string | null)?.trim();
  const notes = (formData.get("notes") as string | null)?.trim() || null;

  if (!scheduledAt) return { error: "Preferred date and time is required." };
  if (!serviceIdInput) return { error: "Please choose an appointment type." };

  // Org-scoped customers can book at any branch in the org. Validate the chosen
  // branch (the form's locationId) against the org's locations; fall back to the
  // landing branch when absent/invalid.
  const requestedBranchId = (formData.get("locationId") as string | null)?.trim() || null;
  const { data: branchData } = await admin
    .from("locations")
    .select("id")
    .eq("organization_id", location.organization.id);
  const branchIds = new Set((branchData ?? []).map((b) => (b as { id: string }).id));
  const branchId = requestedBranchId && branchIds.has(requestedBranchId) ? requestedBranchId : location.id;

  const { data: service } = await admin
    .from("services")
    .select("id, name, category, price")
    .eq("id", serviceIdInput)
    .eq("location_id", branchId)
    .maybeSingle();
  if (!service) return { error: "Selected service is no longer available." };

  const capacity = await bayCapacityAt({
    locationId: branchId,
    scheduledAt: new Date(scheduledAt).toISOString(),
    durationMinutes: 60,
  });
  if (!capacity.available) {
    return {
      error: `That time slot is fully booked (${capacity.occupiedBays}/${capacity.totalBays} bays busy). Please pick another time.`,
    };
  }

  const type = service.category || "service";

  // Plan coverage (funding gate) — same rules as the public widget.
  const servicePricePence = Math.round(Number(service.price ?? 0) * 100);
  const planState = await getCustomerPlanState(admin, cust.id, branchId);
  const coverage = evaluateCoverage(planState, { id: service.id, pricePence: servicePricePence });
  let chargePence = servicePricePence;
  const coveredByPlan = coverage.kind === "covered";
  if (coverage.kind === "covered") {
    chargePence = 0;
  } else if (coverage.kind === "discount") {
    const discountPounds = computeMemberDiscount(Number(service.price ?? 0), coverage.config);
    chargePence = Math.max(0, servicePricePence - Math.round(discountPounds * 100));
  }

  const willPayNow =
    !!location.organization?.stripe_account_id &&
    !!location.organization?.stripe_charges_enabled &&
    chargePence > 0;

  const { data: booking, error } = await admin
    .from("bookings")
    .insert({
      location_id: branchId,
      customer_id: cust.id,
      vehicle_id: vehicleId || null,
      service_id: service.id,
      scheduled_at: new Date(scheduledAt).toISOString(),
      duration_minutes: 60,
      type,
      notes,
      status: willPayNow ? "payment_pending" : "scheduled",
      covered_by_plan: coveredByPlan,
      plan_subscription_id: coveredByPlan && planState ? planState.subscriptionId : null,
    })
    .select("id")
    .single();

  if (error || !booking) return { error: error?.message ?? "Failed to create booking." };

  if (coveredByPlan && planState) {
    await reserveCoverage(admin, planState, { id: service.id, pricePence: servicePricePence }, booking.id);
  }

  const orgName = location.organization?.name ?? location.name;
  const firstName = cust.full_name?.split(" ")[0] ?? "there";
  const typeLabel = service.name;
  const dateStr = new Date(scheduledAt).toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

  if (willPayNow) {
    const amountPence = chargePence;
    try {
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          customer_email: cust.email ?? undefined,
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: "gbp",
                unit_amount: amountPence,
                product_data: {
                  name: `${service.name} — ${orgName}`,
                  description: `Appointment on ${dateStr}`,
                },
              },
            },
          ],
          payment_intent_data: {
            application_fee_amount: platformFeePence(amountPence, effectiveFeePercent(location.organization!)),
            metadata: { booking_id: booking.id },
            receipt_email: cust.email ?? undefined,
          },
          metadata: { booking_id: booking.id },
          success_url: `${tenantOrigin(slug)}/book/${booking.id}/paid?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${tenantOrigin(slug)}/book/${booking.id}/cancelled`,
        },
        { stripeAccount: location.organization!.stripe_account_id! },
      );

      await admin
        .from("bookings")
        .update({ stripe_checkout_session_id: session.id })
        .eq("id", booking.id);

      if (!session.url) return { error: "Stripe did not return a checkout URL." };
      return { success: true, paymentUrl: session.url };
    } catch (err) {
      console.error("[dashboard/book] checkout session create failed", err);
      await admin.from("bookings").update({ status: "scheduled" }).eq("id", booking.id);
      return {
        error:
          "Couldn't start the payment session. Your appointment is requested but not yet paid — please contact the garage.",
      };
    }
  }

  if (cust.email) {
    await sendEmail({
      to: cust.email,
      subject: `Booking request received — ${typeLabel} at ${orgName}`,
      text: `Hi ${firstName},\n\nYour ${typeLabel} appointment request for ${dateStr} has been received by ${orgName}. They will confirm your booking shortly.\n\nThank you,\n${orgName}`,
    });
  }
  if (cust.phone) {
    await sendSms({
      to: cust.phone,
      body: `Hi ${firstName}, your ${typeLabel} request for ${dateStr} at ${orgName} has been received. We'll confirm shortly.`,
    });
  }

  return { success: true };
}
