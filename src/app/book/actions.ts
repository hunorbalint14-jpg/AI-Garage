"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import { normalizeRegistration, validateRegistration } from "@/lib/registration";
import { stripe, platformFeePence, tenantOrigin } from "@/lib/stripe";
import { effectiveFeePercent } from "@/lib/tenant-plans";
import { bayCapacityAt } from "@/lib/bay-availability";
import { verifyQuoteAccess } from "@/lib/quote-links";
import { createStaffNotification } from "@/lib/staff-notifications";
import {
  getCustomerPlanState,
  evaluateCoverage,
  reserveCoverage,
  computeMemberDiscount,
} from "@/lib/service-plans";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type WidgetBookingResult =
  | { error: string }
  | { success: true; paymentUrl?: string };

export async function submitWidgetBooking(
  formData: FormData,
): Promise<WidgetBookingResult> {
  const headersList = await headers();
  const slug = headersList.get("x-tenant-slug");
  if (!slug) return { error: "Garage not found." };

  const admin = createAdminClient();

  // The subdomain resolves to the organisation; the widget books into a branch.
  // Use the requested branch (a later picker passes locationId) else the primary.
  type OrgFields = {
    id: string;
    name: string;
    phone: string | null;
    primary_color: string;
    stripe_account_id: string | null;
    stripe_charges_enabled: boolean | null;
    no_show_fee_pence: number | null;
    tenant_plan: string | null;
    tenant_subscription_status: string | null;
    tenant_current_period_end: string | null;
    tenant_trial_end: string | null;
  };
  const { data: org } = (await admin
    .from("organizations")
    .select(
      "id, name, phone, primary_color, stripe_account_id, stripe_charges_enabled, no_show_fee_pence, tenant_plan, tenant_subscription_status, tenant_current_period_end, tenant_trial_end, locations:locations!organization_id(id, name, slug)",
    )
    .eq("slug", slug)
    .maybeSingle()) as {
    data: (OrgFields & { locations: { id: string; name: string; slug: string }[] | null }) | null;
  };
  if (!org || !org.locations || org.locations.length === 0) return { error: "Garage not found." };

  const requestedBranchId = (formData.get("locationId") as string | null) ?? null;
  const branch = org.locations.find((l) => l.id === requestedBranchId) ?? org.locations[0];
  // Re-shaped to the old `location` object so the downstream booking/payment
  // code is unchanged; `location.id` is the chosen branch. `org` satisfies
  // OrgFields (the extra `locations` key is harmless at runtime).
  const location = { id: branch.id, name: branch.name, organization: org as OrgFields };

  const fullName = (formData.get("fullName") as string | null)?.trim();
  const email = (formData.get("email") as string | null)?.trim().toLowerCase();
  const phone = (formData.get("phone") as string | null)?.trim() || null;
  const regInput = (formData.get("registration") as string | null)?.trim() || null;
  const serviceIdInput = (formData.get("serviceId") as string | null)?.trim() || null;
  const scheduledAt = (formData.get("scheduledAt") as string | null)?.trim();
  const notes = (formData.get("notes") as string | null)?.trim() || null;
  const marketingConsent = formData.get("marketingConsent") === "on";
  const fromQuoteSlug = (formData.get("fromQuoteSlug") as string | null)?.trim() || null;
  const fromQuoteToken = (formData.get("fromQuoteToken") as string | null)?.trim() || null;

  if (!fullName) return { error: "Name is required." };
  if (!email || !EMAIL_RE.test(email)) return { error: "A valid email is required." };
  if (!scheduledAt) return { error: "Preferred date and time is required." };
  if (!serviceIdInput) return { error: "Please choose an appointment type." };

  // Look up the service for type label + price.
  const { data: service } = await admin
    .from("services")
    .select("id, name, category, price")
    .eq("id", serviceIdInput)
    .eq("location_id", location.id)
    .maybeSingle();
  if (!service) return { error: "Selected service is no longer available." };

  // Capacity guard — refuse if all bays at this location are already
  // occupied for the requested window. Locations with zero bays defined
  // pass through (they're not using bay-based capacity).
  const capacity = await bayCapacityAt({
    locationId: location.id,
    scheduledAt: new Date(scheduledAt).toISOString(),
    durationMinutes: 60,
  });
  if (!capacity.available) {
    return {
      error: `That time slot is fully booked (${capacity.occupiedBays}/${capacity.totalBays} bays busy). Please pick another time.`,
    };
  }

  // Validate registration if provided
  let registration: string | null = null;
  if (regInput) {
    const regError = validateRegistration(regInput);
    if (regError) return { error: regError };
    registration = normalizeRegistration(regInput);
  }

  // If the user is signed in, hook the customer record to their auth.users id.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Find or create customer — one per ORG (matched across all branches).
  const { data: existingCustomer } = await admin
    .from("customers")
    .select("id, full_name, email, phone, user_id")
    .eq("organization_id", org.id)
    .eq("email", email)
    .maybeSingle();

  let customerId: string;

  if (existingCustomer) {
    customerId = existingCustomer.id;
    const updates: Record<string, string | null> = {};
    if (!existingCustomer.phone && phone) updates.phone = phone;
    if (user && !existingCustomer.user_id) updates.user_id = user.id;
    if (Object.keys(updates).length > 0) {
      await admin.from("customers").update(updates).eq("id", customerId);
    }
  } else {
    const { data: newCustomer, error: custErr } = await admin
      .from("customers")
      .insert({
        organization_id: org.id,
        preferred_location_id: branch.id,
        full_name: fullName,
        email,
        phone,
        user_id: user?.id ?? null,
        marketing_email_consent: marketingConsent,
        marketing_sms_consent: marketingConsent,
        consent_updated_at: marketingConsent ? new Date().toISOString() : null,
      })
      .select("id")
      .single();
    if (custErr) return { error: "Failed to create customer record." };
    customerId = newCustomer.id;
  }

  // Find or create vehicle — one per ORG (matched by registration org-wide).
  let vehicleId: string | null = null;
  if (registration) {
    const { data: existingVehicle } = await admin
      .from("vehicles")
      .select("id")
      .eq("organization_id", org.id)
      .eq("registration", registration)
      .maybeSingle();

    if (existingVehicle) {
      vehicleId = existingVehicle.id;
    } else {
      const { data: newVehicle } = await admin
        .from("vehicles")
        .insert({ organization_id: org.id, location_id: branch.id, customer_id: customerId, registration })
        .select("id")
        .single();
      if (newVehicle) vehicleId = newVehicle.id;
    }
  }

  // Service category (mot/service/repair/etc.) feeds the existing `type` enum
  // so dashboards keep working unchanged.
  const type = service.category || "service";

  // Plan coverage: included services are free for a funded member (funding gate),
  // an active-but-not-free member gets the plan discount, everyone else pays the
  // walk-in price. See docs/ai-garage-policy-build-spec.md §3.1.
  const servicePricePence = Math.round(Number(service.price ?? 0) * 100);
  const planState = await getCustomerPlanState(admin, customerId, location.id);
  const coverage = evaluateCoverage(planState, { id: service.id, pricePence: servicePricePence });
  let chargePence = servicePricePence;
  const coveredByPlan = coverage.kind === "covered";
  if (coverage.kind === "covered") {
    chargePence = 0;
  } else if (coverage.kind === "discount") {
    const discountPounds = computeMemberDiscount(Number(service.price ?? 0), coverage.config);
    chargePence = Math.max(0, servicePricePence - Math.round(discountPounds * 100));
  }

  // Create booking — payment_pending if we're about to redirect to Stripe,
  // scheduled otherwise.
  const willPayNow =
    !!location.organization.stripe_account_id &&
    !!location.organization.stripe_charges_enabled &&
    chargePence > 0;

  // Resolve the originating quote if the customer came in via the "Decline
  // & book separate" flow. The booking row carries from_quote_id so that
  // startBooking() can later seed the new job with the snapshot items.
  let fromQuoteId: string | null = null;
  if (fromQuoteSlug && fromQuoteToken) {
    const verify = await verifyQuoteAccess(fromQuoteSlug, fromQuoteToken, ["rebooked", "pending"]);
    if (verify.ok && verify.quote.location_id === location.id) {
      fromQuoteId = verify.quote.id;
    }
  }

  // Build insert payload — only include from_quote_id if the v2 column exists.
  // Try with it first; if Postgres rejects (column doesn't exist), retry without.
  const baseInsert: Record<string, unknown> = {
    location_id: location.id,
    customer_id: customerId,
    vehicle_id: vehicleId,
    service_id: service.id,
    scheduled_at: new Date(scheduledAt).toISOString(),
    duration_minutes: 60,
    type,
    notes,
    status: willPayNow ? "payment_pending" : "scheduled",
    covered_by_plan: coveredByPlan,
    plan_subscription_id: coveredByPlan && planState ? planState.subscriptionId : null,
  };

  let booking: { id: string } | null = null;
  let bookingErr: { message: string } | null = null;

  if (fromQuoteId) {
    const res = await admin
      .from("bookings")
      .insert({ ...baseInsert, from_quote_id: fromQuoteId })
      .select("id")
      .single();
    if (res.error?.message?.includes("from_quote_id")) {
      // Column doesn't exist yet — retry without it.
      const fallback = await admin.from("bookings").insert(baseInsert).select("id").single();
      booking = fallback.data;
      bookingErr = fallback.error;
    } else {
      booking = res.data;
      bookingErr = res.error;
    }
  } else {
    const res = await admin.from("bookings").insert(baseInsert).select("id").single();
    booking = res.data;
    bookingErr = res.error;
  }

  if (bookingErr || !booking) return { error: bookingErr?.message ?? "Failed to create booking." };

  // Reserve the included-service allowance against this booking (released on
  // cancel/no-show, consumed when the £0 invoice is raised).
  if (coveredByPlan && planState) {
    await reserveCoverage(admin, planState, { id: service.id, pricePence: servicePricePence }, booking.id);
  }

  // If the booking was rebooked from a quote, drop an in-app notification
  // for the location's staff so the mechanic sees the trail from quote → booking.
  if (fromQuoteId) {
    const { data: quoteRow } = await admin
      .from("job_quotes")
      .select("created_by, job_id, total")
      .eq("id", fromQuoteId)
      .maybeSingle();
    type QuoteRow = { created_by: string | null; job_id: string; total: number };
    const qrow = quoteRow as QuoteRow | null;
    const totalFmt = qrow ? new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(qrow.total) : "";
    void createStaffNotification({
      userId: qrow?.created_by ?? null,
      locationId: location.id,
      organizationId: location.organization.id,
      kind: "quote.rebooked",
      title: `Quote → new booking from ${fullName}`,
      body: `${registration ?? "vehicle"} · ${totalFmt} · ${new Date(scheduledAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`,
      href: `/staff/bookings/${booking.id}`,
      entityType: "booking",
      entityId: booking.id,
    });
  }

  const garageName = location.organization.name;
  const garagePhone = location.organization.phone;
  const typeLabel = service.name;
  const dateStr = new Date(scheduledAt).toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  const firstName = fullName.split(" ")[0];

  // Stripe Checkout when there's an amount to charge and the garage is connected.
  if (willPayNow) {
    const amountPence = chargePence;
    try {
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          customer_email: email,
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: "gbp",
                unit_amount: amountPence,
                product_data: {
                  name: `${service.name} — ${garageName}`,
                  description: `Appointment on ${dateStr}${registration ? ` for ${registration}` : ""}`,
                },
              },
            },
          ],
          payment_intent_data: {
            application_fee_amount: platformFeePence(amountPence, effectiveFeePercent(location.organization)),
            metadata: { booking_id: booking.id },
            receipt_email: email,
          },
          metadata: { booking_id: booking.id },
          success_url: `${tenantOrigin(slug)}/book/${booking.id}/paid?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${tenantOrigin(slug)}/book/${booking.id}/cancelled`,
        },
        { stripeAccount: location.organization.stripe_account_id! },
      );

      await admin
        .from("bookings")
        .update({ stripe_checkout_session_id: session.id })
        .eq("id", booking.id);

      if (!session.url) {
        return { error: "Stripe did not return a checkout URL." };
      }
      return { success: true, paymentUrl: session.url };
    } catch (err) {
      console.error("[book] checkout session create failed", err);
      // Don't strand a booking row marked payment_pending — flip it back to
      // scheduled and surface the failure so the customer can try again.
      await admin
        .from("bookings")
        .update({ status: "scheduled" })
        .eq("id", booking.id);
      return {
        error: "Couldn't start the payment session. Your appointment is requested but not yet paid — please contact the garage.",
      };
    }
  }

  // No payment path — fire confirmation comms as before.
  const confirmText = `Hi ${firstName},\n\nYour ${typeLabel} appointment${registration ? ` for ${registration}` : ""} at ${garageName} is confirmed for ${dateStr}.${garagePhone ? `\n\nTo reschedule or cancel, call us on ${garagePhone} or reply to this email.` : "\n\nTo reschedule or cancel, reply to this email."}\n\nSee you then!\n${garageName}`;

  await sendEmail({
    to: email,
    subject: `Booking confirmed — ${typeLabel} at ${garageName}`,
    text: confirmText,
  });
  if (phone) {
    await sendSms({
      to: phone,
      body: `Hi ${firstName}, your ${typeLabel} at ${garageName} on ${dateStr} is confirmed.${garagePhone ? ` Call ${garagePhone} to reschedule.` : ""}`,
    });
  }

  // Notify staff (org owners/admins)
  const { data: orgUsers } = await admin
    .from("org_users")
    .select("user_id")
    .eq("organization_id", location.organization.id);

  for (const { user_id } of orgUsers ?? []) {
    const { data } = await admin.auth.admin.getUserById(user_id);
    if (data.user?.email) {
      await sendEmail({
        to: data.user.email,
        subject: `New booking — ${typeLabel} from ${fullName}`,
        text: `New booking via the widget:\n\nCustomer: ${fullName} (${email}${phone ? `, ${phone}` : ""})\nType: ${typeLabel}\nPreferred: ${dateStr}${registration ? `\nVehicle: ${registration}` : ""}${notes ? `\nNotes: ${notes}` : ""}\n\nLog in to view the booking in the staff portal.`,
      });
    }
  }

  // No-show defence: when the org sets a fee and the booking wasn't prepaid,
  // offer a card-save step (Stripe Checkout in setup mode on the connected
  // account). The booking is confirmed either way — abandoning the card step
  // never voids the appointment; charging the fee is a manual staff decision.
  const noShowFeePence = Number(location.organization.no_show_fee_pence ?? 0);
  if (
    noShowFeePence > 0 &&
    location.organization.stripe_account_id &&
    location.organization.stripe_charges_enabled
  ) {
    const feeFmt = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
      noShowFeePence / 100,
    );
    try {
      const session = await stripe.checkout.sessions.create(
        {
          mode: "setup",
          customer_creation: "always",
          customer_email: email,
          currency: "gbp",
          metadata: { kind: "no_show_card", booking_id: booking.id },
          custom_text: {
            submit: {
              message: `No payment is taken now. Your card is only charged the ${feeFmt} no-show fee if you miss your appointment without telling ${garageName}.`,
            },
          },
          success_url: `${tenantOrigin(slug)}/book/${booking.id}/card-saved`,
          cancel_url: `${tenantOrigin(slug)}/book/${booking.id}/card-saved?skipped=1`,
        },
        { stripeAccount: location.organization.stripe_account_id },
      );
      if (session.url) {
        await admin
          .from("bookings")
          .update({ stripe_checkout_session_id: session.id })
          .eq("id", booking.id);
        return { success: true, paymentUrl: session.url };
      }
    } catch (err) {
      // Card-on-file is best effort — never fail a confirmed booking over it.
      console.error("[book] no-show setup session failed", err);
    }
  }

  return { success: true };
}
