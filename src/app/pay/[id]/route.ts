import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe, platformFeePence, publicOrigin } from "@/lib/stripe";
import { effectiveFeePercent } from "@/lib/tenant-plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Customer-facing pay link. Anyone with the invoice ID can hit this route;
// we don't expose financial detail until the Stripe Checkout page itself.
// The invoice's connected Stripe account collects the funds; AI Garage
// skims a percentage as the platform fee.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const admin = createAdminClient();

  const { data: invoice } = await admin
    .from("invoices")
    .select(
      "id, invoice_number, status, total, location_id, customer:customers(full_name, email), location:locations(slug, organization:organizations(name, stripe_account_id, stripe_charges_enabled, tenant_plan, tenant_subscription_status, tenant_current_period_end, tenant_trial_end))",
    )
    .eq("id", id)
    .maybeSingle();

  type InvoiceRow = {
    id: string;
    invoice_number: string;
    status: string;
    total: number;
    location_id: string;
    customer: { full_name: string | null; email: string | null } | null;
    location: {
      slug: string;
      organization: {
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
  const inv = invoice as unknown as InvoiceRow | null;
  if (!inv) {
    return new NextResponse("Invoice not found.", { status: 404 });
  }

  if (inv.status === "paid") {
    return NextResponse.redirect(new URL(`/pay/${id}/done`, request.url));
  }

  const org = inv.location?.organization;
  if (!org?.stripe_account_id || !org.stripe_charges_enabled) {
    return new NextResponse(
      "This garage hasn't finished setting up online card payments yet.",
      { status: 503 },
    );
  }

  const amountPence = Math.round(Number(inv.total) * 100);
  if (!Number.isFinite(amountPence) || amountPence <= 0) {
    return new NextResponse("Invoice total is invalid.", { status: 400 });
  }

  const successUrl = `${publicOrigin()}/pay/${inv.id}/done?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${publicOrigin()}/pay/${inv.id}/cancelled`;

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        customer_email: inv.customer?.email ?? undefined,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "gbp",
              unit_amount: amountPence,
              product_data: {
                name: `Invoice ${inv.invoice_number}`,
                description: `Payment to ${org.name}`,
              },
            },
          },
        ],
        payment_intent_data: {
          application_fee_amount: platformFeePence(amountPence, effectiveFeePercent(org)),
          metadata: { invoice_id: inv.id },
          receipt_email: inv.customer?.email ?? undefined,
        },
        metadata: { invoice_id: inv.id },
        success_url: successUrl,
        cancel_url: cancelUrl,
      },
      { stripeAccount: org.stripe_account_id },
    );

    await admin
      .from("invoices")
      .update({ stripe_checkout_session_id: session.id })
      .eq("id", inv.id);

    if (!session.url) {
      return new NextResponse("Stripe did not return a checkout URL.", { status: 500 });
    }
    return NextResponse.redirect(session.url);
  } catch (err) {
    console.error("[pay] checkout session create failed", err);
    return new NextResponse(
      "Could not start the payment session. Please contact the garage.",
      { status: 500 },
    );
  }
}
