"use server";

import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe, tenantOrigin } from "@/lib/stripe";
import { logAudit } from "@/lib/audit";
import { tenantPriceId, type TierKey } from "@/lib/tenant-plans";

export type BillingResult = { error: string } | { url: string };

type Admin = ReturnType<typeof createAdminClient>;

// Get (or lazily create) the org's Customer on the PLATFORM Stripe account.
async function ensureTenantCustomer(
  admin: Admin,
  orgId: string,
  orgName: string,
  email: string | undefined,
): Promise<string | null> {
  const { data } = await admin
    .from("organizations")
    .select("tenant_stripe_customer_id")
    .eq("id", orgId)
    .maybeSingle();
  const existing = (data as { tenant_stripe_customer_id: string | null } | null)?.tenant_stripe_customer_id;
  if (existing) return existing;

  const customer = await stripe.customers.create({
    name: orgName,
    email: email ?? undefined,
    metadata: { organization_id: orgId },
  });
  await admin.from("organizations").update({ tenant_stripe_customer_id: customer.id }).eq("id", orgId);
  return customer.id;
}

// Start a platform-account subscription Checkout for a paid tier. Owner only.
export async function startTenantCheckout(
  tier: Exclude<TierKey, "starter">,
  interval: "month" | "year",
): Promise<BillingResult> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner") return { error: "Only the account owner can manage billing." };

  const priceId = tenantPriceId(tier, interval);
  if (!priceId) return { error: "Online sign-up for this plan isn't configured yet." };

  const admin = createAdminClient();
  const customerId = await ensureTenantCustomer(admin, ctx.organization.id, ctx.organization.name, ctx.user.email);
  if (!customerId) return { error: "Could not start billing. Please try again." };

  // Never create a second subscription. If one is already live, send them to the
  // billing portal to upgrade / downgrade / cancel instead.
  try {
    const existing = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
    const hasLive = existing.data.some(
      (s) => s.metadata?.kind === "tenant_billing" && ["active", "trialing", "past_due"].includes(s.status),
    );
    if (hasLive) {
      return { error: "You already have an active subscription. Use “Manage billing” to change or cancel your plan." };
    }
  } catch (err) {
    console.error("[tenant-billing] existing-subscription check failed", err);
  }

  const origin = tenantOrigin(ctx.location.slug);
  const metadata = { kind: "tenant_billing", organization_id: ctx.organization.id, tier };

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { metadata },
      metadata,
      success_url: `${origin}/staff/settings/billing?upgraded=1`,
      cancel_url: `${origin}/staff/settings/billing`,
    });

    await logAudit({
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email ?? null,
      action: "tenant.subscribe",
      entityType: "organization",
      entityId: ctx.organization.id,
      metadata: { tier, interval },
    });

    if (!session.url) return { error: "Stripe did not return a checkout URL." };
    return { url: session.url };
  } catch (err) {
    console.error("[tenant-billing] checkout create failed", err);
    return { error: "Could not start the subscription. Please try again later." };
  }
}

// Open the Stripe Billing Portal so the owner can update their card, switch tier,
// or cancel. Owner only.
export async function openBillingPortal(): Promise<BillingResult> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner") return { error: "Only the account owner can manage billing." };

  const admin = createAdminClient();
  const { data } = await admin
    .from("organizations")
    .select("tenant_stripe_customer_id")
    .eq("id", ctx.organization.id)
    .maybeSingle();
  const customerId = (data as { tenant_stripe_customer_id: string | null } | null)?.tenant_stripe_customer_id;
  if (!customerId) return { error: "No billing account yet — subscribe to a plan first." };

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${tenantOrigin(ctx.location.slug)}/staff/settings/billing?upgraded=1`,
    });
    return { url: session.url };
  } catch (err) {
    console.error("[tenant-billing] portal create failed", err);
    return { error: "Could not open the billing portal. Please try again later." };
  }
}
