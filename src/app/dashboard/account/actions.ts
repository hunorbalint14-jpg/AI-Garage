"use server";

import { redirect } from "next/navigation";
import { getPortalContext } from "@/lib/portal-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe, platformFeePence, publicOrigin } from "@/lib/stripe";
import { effectiveFeePercent } from "@/lib/tenant-plans";
import { accountProfile } from "@/lib/account";

// Pay-the-balance Stripe checkout for account customers (#504 follow-up).
// One card payment covers every open invoice oldest-first: the webhook's
// account_balance branch records a ledger payment through the same applier
// staff use, so statements and `paid` semantics are identical to a BACS
// receipt keyed in at the desk.

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function payBalanceCheckout(): Promise<{ error: string } | never> {
  const { organization, customer } = await getPortalContext();
  if (!customer) return { error: "No customer record." };
  const admin = createAdminClient();

  const profile = await accountProfile(admin, customer.id);
  if (!profile?.accountCustomer) return { error: "Not an account customer." };

  const { data: orgRow } = await admin
    .from("organizations")
    .select(
      "name, stripe_account_id, stripe_charges_enabled, primary_location_id, tenant_plan, tenant_subscription_status, tenant_current_period_end, tenant_trial_end",
    )
    .eq("id", organization.id)
    .maybeSingle();
  const org = orgRow as {
    name: string;
    stripe_account_id: string | null;
    stripe_charges_enabled: boolean | null;
    primary_location_id: string | null;
    tenant_plan: string | null;
    tenant_subscription_status: string | null;
    tenant_current_period_end: string | null;
    tenant_trial_end: string | null;
  } | null;
  if (!org?.stripe_account_id || !org.stripe_charges_enabled) {
    return { error: "This garage hasn't finished setting up online card payments yet." };
  }

  // Outstanding = open sent invoices net of part-payments.
  const { data: openRows } = await admin
    .from("invoices")
    .select("total, amount_paid")
    .eq("customer_id", customer.id)
    .eq("status", "sent");
  const outstanding = r2(
    ((openRows ?? []) as { total: number; amount_paid: number }[]).reduce(
      (s, i) => s + Math.max(0, Number(i.total) - Number(i.amount_paid ?? 0)),
      0,
    ),
  );
  if (outstanding <= 0) return { error: "Nothing outstanding to pay." };

  // The payments row needs a branch: the customer's home branch, else primary.
  const { data: custRow } = await admin
    .from("customers")
    .select("preferred_location_id")
    .eq("id", customer.id)
    .maybeSingle();
  let locationId = (custRow as { preferred_location_id: string | null } | null)?.preferred_location_id ?? org.primary_location_id;
  if (!locationId) {
    const { data: loc } = await admin.from("locations").select("id").eq("organization_id", organization.id).limit(1).maybeSingle();
    locationId = (loc as { id: string } | null)?.id ?? null;
  }
  if (!locationId) return { error: "No branch found for this garage." };

  const amountPence = Math.round(outstanding * 100);
  let url: string | null = null;
  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        customer_email: customer.email ?? undefined,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "gbp",
              unit_amount: amountPence,
              product_data: {
                name: "Account balance",
                description: `Payment on account to ${org.name}`,
              },
            },
          },
        ],
        payment_intent_data: {
          application_fee_amount: platformFeePence(amountPence, effectiveFeePercent(org)),
          metadata: { kind: "account_balance", customer_id: customer.id, organization_id: organization.id },
          receipt_email: customer.email ?? undefined,
        },
        metadata: {
          kind: "account_balance",
          customer_id: customer.id,
          organization_id: organization.id,
          location_id: locationId,
        },
        success_url: `${publicOrigin()}/dashboard/account?paid=1`,
        cancel_url: `${publicOrigin()}/dashboard/account`,
      },
      { stripeAccount: org.stripe_account_id },
    );
    url = session.url;
  } catch (err) {
    console.error("[account] balance checkout create failed", err);
    return { error: "Could not start the payment. Please try again or contact the garage." };
  }
  if (!url) return { error: "Stripe did not return a checkout URL." };
  redirect(url);
}
