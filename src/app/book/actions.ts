"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import { normalizeRegistration, validateRegistration } from "@/lib/registration";
import { stripe, platformFeePence, publicOrigin } from "@/lib/stripe";

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

  const { data: location } = await admin
    .from("locations")
    .select(
      "id, name, organization:organizations(id, name, phone, primary_color, stripe_account_id, stripe_charges_enabled)",
    )
    .eq("slug", slug)
    .maybeSingle() as {
    data: {
      id: string;
      name: string;
      organization: {
        id: string;
        name: string;
        phone: string | null;
        primary_color: string;
        stripe_account_id: string | null;
        stripe_charges_enabled: boolean | null;
      } | null;
    } | null;
  };

  if (!location?.organization) return { error: "Garage not found." };

  const fullName = (formData.get("fullName") as string | null)?.trim();
  const email = (formData.get("email") as string | null)?.trim().toLowerCase();
  const phone = (formData.get("phone") as string | null)?.trim() || null;
  const regInput = (formData.get("registration") as string | null)?.trim() || null;
  const serviceIdInput = (formData.get("serviceId") as string | null)?.trim() || null;
  const scheduledAt = (formData.get("scheduledAt") as string | null)?.trim();
  const notes = (formData.get("notes") as string | null)?.trim() || null;
  const marketingConsent = formData.get("marketingConsent") === "on";

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

  // Find or create customer
  const { data: existingCustomer } = await admin
    .from("customers")
    .select("id, full_name, email, phone, user_id")
    .eq("location_id", location.id)
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
        location_id: location.id,
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

  // Find or create vehicle
  let vehicleId: string | null = null;
  if (registration) {
    const { data: existingVehicle } = await admin
      .from("vehicles")
      .select("id")
      .eq("location_id", location.id)
      .eq("registration", registration)
      .maybeSingle();

    if (existingVehicle) {
      vehicleId = existingVehicle.id;
    } else {
      const { data: newVehicle } = await admin
        .from("vehicles")
        .insert({ location_id: location.id, customer_id: customerId, registration })
        .select("id")
        .single();
      if (newVehicle) vehicleId = newVehicle.id;
    }
  }

  // Service category (mot/service/repair/etc.) feeds the existing `type` enum
  // so dashboards keep working unchanged.
  const type = service.category || "service";

  // Create booking — payment_pending if we're about to redirect to Stripe,
  // scheduled otherwise.
  const willPayNow =
    !!location.organization.stripe_account_id &&
    !!location.organization.stripe_charges_enabled &&
    !!service.price &&
    Number(service.price) > 0;

  const { data: booking, error: bookingErr } = await admin
    .from("bookings")
    .insert({
      location_id: location.id,
      customer_id: customerId,
      vehicle_id: vehicleId,
      service_id: service.id,
      scheduled_at: new Date(scheduledAt).toISOString(),
      duration_minutes: 60,
      type,
      notes,
      status: willPayNow ? "payment_pending" : "scheduled",
    })
    .select("id")
    .single();

  if (bookingErr || !booking) return { error: bookingErr?.message ?? "Failed to create booking." };

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

  // Stripe Checkout when the service has a price and the garage is connected.
  if (willPayNow) {
    const amountPence = Math.round(Number(service.price) * 100);
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
            application_fee_amount: platformFeePence(amountPence),
            metadata: { booking_id: booking.id },
            receipt_email: email,
          },
          metadata: { booking_id: booking.id },
          success_url: `${publicOrigin()}/book/${booking.id}/paid?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${publicOrigin()}/book/${booking.id}/cancelled`,
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

  return { success: true };
}
