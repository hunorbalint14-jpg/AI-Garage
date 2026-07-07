import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe, platformFeePence, tenantOrigin } from "@/lib/stripe";
import { effectiveFeePercent } from "@/lib/tenant-plans";
import { garageLabel } from "@/lib/garage-identity";

// Recover an abandoned booking payment: /book/{id}/pay re-opens the Stripe
// Checkout for a payment_pending booking. The original session is reused
// while it's still open; otherwise a fresh one is created for the SAME
// amount (read back from the original session, so plan-coverage discounts
// applied at booking time are preserved). Linked from the payment-cancelled
// page — without this, a customer who closed the Stripe tab was stranded
// with a payment_pending booking and no way back.

type Row = {
  id: string;
  status: string;
  scheduled_at: string;
  stripe_checkout_session_id: string | null;
  type: string;
  customer: { email: string | null; full_name: string | null } | null;
  vehicle: { registration: string | null } | null;
  service: { name: string } | null;
  location: {
    name: string;
    address: string | null;
    organization: {
      slug: string;
      name: string;
      stripe_account_id: string | null;
      stripe_charges_enabled: boolean | null;
      tenant_plan: string | null;
      tenant_subscription_status: string | null;
      tenant_current_period_end: string | null;
      tenant_trial_end: string | null;
    } | null;
  } | null;
};

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = createAdminClient();

  const { data } = await admin
    .from("bookings")
    .select(
      "id, status, scheduled_at, stripe_checkout_session_id, type, customer:customers(email, full_name), vehicle:vehicles(registration), service:services(name), location:locations(name, address, organization:organizations!organization_id(slug, name, stripe_account_id, stripe_charges_enabled, tenant_plan, tenant_subscription_status, tenant_current_period_end, tenant_trial_end))",
    )
    .eq("id", id)
    .maybeSingle();

  const booking = data as unknown as Row | null;
  const org = booking?.location?.organization ?? null;
  const fallback = org ? `${tenantOrigin(org.slug)}/book` : "/";

  if (
    !booking ||
    !org ||
    booking.status !== "payment_pending" ||
    !org.stripe_account_id ||
    !org.stripe_charges_enabled ||
    !booking.stripe_checkout_session_id
  ) {
    return NextResponse.redirect(fallback, 303);
  }

  try {
    const stripeAccount = { stripeAccount: org.stripe_account_id };
    const existing = await stripe.checkout.sessions.retrieve(
      booking.stripe_checkout_session_id,
      {},
      stripeAccount,
    );

    // Still open (sessions live 24h) → straight back in.
    if (existing.status === "open" && existing.url) {
      return NextResponse.redirect(existing.url, 303);
    }
    // Paid meanwhile (webhook race) → nothing to pay.
    if (existing.payment_status === "paid") {
      return NextResponse.redirect(`${tenantOrigin(org.slug)}/book/${booking.id}/paid`, 303);
    }

    const amountPence = existing.amount_total ?? 0;
    if (amountPence <= 0) return NextResponse.redirect(fallback, 303);

    const where = garageLabel({
      orgName: org.name,
      locationName: booking.location!.name,
      address: booking.location!.address,
    });
    const dateStr = new Date(booking.scheduled_at).toLocaleString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });
    const reg = booking.vehicle?.registration ?? null;
    const serviceName =
      booking.service?.name ?? (booking.type === "mot" ? "MOT" : booking.type);

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        customer_email: booking.customer?.email ?? undefined,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "gbp",
              unit_amount: amountPence,
              product_data: {
                name: `${serviceName} — ${where}`,
                description: `Appointment on ${dateStr}${reg ? ` for ${reg}` : ""}`,
              },
            },
          },
        ],
        payment_intent_data: {
          application_fee_amount: platformFeePence(amountPence, effectiveFeePercent(org)),
          metadata: { booking_id: booking.id },
          receipt_email: booking.customer?.email ?? undefined,
        },
        metadata: { booking_id: booking.id },
        success_url: `${tenantOrigin(org.slug)}/book/${booking.id}/paid?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${tenantOrigin(org.slug)}/book/${booking.id}/cancelled`,
      },
      stripeAccount,
    );

    if (!session.url) return NextResponse.redirect(fallback, 303);
    await admin
      .from("bookings")
      .update({ stripe_checkout_session_id: session.id })
      .eq("id", booking.id);
    return NextResponse.redirect(session.url, 303);
  } catch (err) {
    console.error("[book/pay] checkout re-open failed", err);
    return NextResponse.redirect(fallback, 303);
  }
}
