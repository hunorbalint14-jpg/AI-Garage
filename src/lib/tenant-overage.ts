import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TIERS } from "@/lib/tenant-plans";

// Growth per-location overage (#461): locations beyond the included 7 bill at
// £25/site/mo as a quantity-based item on the tenant subscription. This
// module owns the quantity maths + the Stripe sync; callers are the
// add-location action, the tenant-billing webhook and the reconcile cron.

export const OVERAGE_PRICE_ENV = "STRIPE_TENANT_PRICE_GROWTH_OVERAGE";

/** Billable extra sites for a plan. Only Growth meters; everything else 0. */
export function overageQuantity(plan: string | null, locationCount: number): number {
  if (plan !== "growth") return 0;
  return Math.max(0, locationCount - TIERS.growth.maxLocations);
}

export type OverageSyncResult =
  | { status: "noop"; reason: string }
  | { status: "synced"; quantity: number }
  | { status: "error"; message: string };

// Bring the subscription's overage item in line with reality. Idempotent —
// safe from the action, the webhook and the cron at once. Stripe prorates
// quantity changes mid-period by default (create_prorations).
export async function syncLocationOverage(
  admin: SupabaseClient,
  stripe: Stripe,
  organizationId: string,
): Promise<OverageSyncResult> {
  const priceId = process.env[OVERAGE_PRICE_ENV];
  if (!priceId) return { status: "noop", reason: "no overage price configured" };

  const { data: orgRow } = await admin
    .from("organizations")
    .select("tenant_plan, tenant_subscription_status, tenant_stripe_subscription_id")
    .eq("id", organizationId)
    .maybeSingle();
  const org = orgRow as {
    tenant_plan: string | null;
    tenant_subscription_status: string | null;
    tenant_stripe_subscription_id: string | null;
  } | null;
  if (!org?.tenant_stripe_subscription_id) return { status: "noop", reason: "no subscription" };
  if (!["active", "trialing", "past_due"].includes(org.tenant_subscription_status ?? "")) {
    return { status: "noop", reason: `subscription ${org.tenant_subscription_status}` };
  }

  const { count } = await admin
    .from("locations")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);
  const quantity = overageQuantity(org.tenant_plan, count ?? 0);

  try {
    const sub = await stripe.subscriptions.retrieve(org.tenant_stripe_subscription_id);
    const item = sub.items.data.find((i) => i.price.id === priceId);

    if (!item && quantity > 0) {
      await stripe.subscriptionItems.create({
        subscription: sub.id,
        price: priceId,
        quantity,
        proration_behavior: "create_prorations",
      });
    } else if (item && quantity === 0) {
      await stripe.subscriptionItems.del(item.id, { proration_behavior: "create_prorations" });
    } else if (item && item.quantity !== quantity) {
      await stripe.subscriptionItems.update(item.id, {
        quantity,
        proration_behavior: "create_prorations",
      });
    }
    return { status: "synced", quantity };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[overage] sync failed", { organizationId, message });
    return { status: "error", message };
  }
}
