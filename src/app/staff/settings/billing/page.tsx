import { redirect } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";
import { PageHeader } from "@/components/staff/page-header";
import { TIERS, tierFor, recordTenantSubscription, type TierKey, type OrgBilling } from "@/lib/tenant-plans";
import { UpgradeButtons, ManageBillingButton } from "./billing-client";
import { UpgradeSuccessModal } from "./upgrade-success-modal";

const LIVE_STATUSES = ["active", "trialing", "past_due"];

const FEATURE_LABELS: Record<string, string> = {
  xero: "Xero accounting sync",
  campaigns: "Marketing campaigns",
  automations: "Automations",
};

const fmtPrice = (pence: number) =>
  pence === 0 ? "Free" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);
const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "—";

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ upgraded?: string }> }) {
  const { upgraded } = await searchParams;
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner") redirect("/staff");

  const admin = createAdminClient();
  const billingCols =
    "tenant_plan, tenant_subscription_status, tenant_current_period_end, tenant_trial_end";

  const { data } = await admin
    .from("organizations")
    .select(`${billingCols}, tenant_stripe_customer_id`)
    .eq("id", ctx.organization.id)
    .maybeSingle();
  const customerId = (data as { tenant_stripe_customer_id: string | null } | null)?.tenant_stripe_customer_id ?? null;
  let org = (data ?? {
    tenant_plan: "starter",
    tenant_subscription_status: null,
    tenant_current_period_end: null,
    tenant_trial_end: null,
  }) as OrgBilling;

  // Self-heal: reconcile the tier straight from Stripe so the page is correct
  // even if a platform-account webhook was missed/not yet configured.
  if (customerId) {
    try {
      const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
      const tenantSubs = subs.data.filter((s) => s.metadata?.kind === "tenant_billing");
      const live =
        tenantSubs.find((s) => LIVE_STATUSES.includes(s.status)) ??
        tenantSubs.sort((a, b) => b.created - a.created)[0];
      if (live) {
        await recordTenantSubscription(admin, live);
        const { data: fresh } = await admin
          .from("organizations")
          .select(billingCols)
          .eq("id", ctx.organization.id)
          .maybeSingle();
        if (fresh) org = fresh as OrgBilling;
      }
    } catch (err) {
      console.error("[billing] stripe reconcile failed", err);
    }
  }

  const current = tierFor(org);
  const subscribed =
    !!org.tenant_subscription_status && LIVE_STATUSES.includes(org.tenant_subscription_status);
  const trialActive = !!org.tenant_trial_end && new Date(org.tenant_trial_end) > new Date();
  const order: TierKey[] = ["starter", "pro", "growth"];

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <PageHeader
        title="Billing"
        description="Your AI Garage plan. Higher tiers unlock features and lower the platform fee on customer payments."
      />

      {upgraded && <UpgradeSuccessModal planName={current.name} />}

      <section className="rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">Current plan</p>
            <p className="text-lg font-semibold">{current.name}</p>
            <p className="text-xs text-muted-foreground">
              {current.feePercent}% platform fee
              {org.tenant_subscription_status ? ` · ${org.tenant_subscription_status}` : ""}
              {trialActive ? ` · Pro trial until ${fmtDate(org.tenant_trial_end)}` : ""}
              {org.tenant_current_period_end ? ` · renews ${fmtDate(org.tenant_current_period_end)}` : ""}
            </p>
          </div>
          <ManageBillingButton />
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        {order.map((key) => {
          const t = TIERS[key];
          const isCurrent = key === current.key;
          const enabledFeatures = Object.entries(t.features).filter(([, on]) => on);
          return (
            <div key={key} className={`flex flex-col gap-3 rounded-lg border p-4 ${isCurrent ? "border-primary" : ""}`}>
              <div>
                <p className="font-semibold">{t.name}</p>
                <p className="text-sm">
                  {fmtPrice(t.monthlyPence)}
                  {t.monthlyPence > 0 ? "/mo" : ""}
                </p>
                <p className="text-xs text-muted-foreground">{t.feePercent}% platform fee</p>
              </div>

              <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
                <li>
                  {t.maxLocations === Number.POSITIVE_INFINITY ? "Unlimited" : t.maxLocations} location
                  {t.maxLocations === 1 ? "" : "s"}
                </li>
                {enabledFeatures.length > 0 ? (
                  enabledFeatures.map(([f]) => <li key={f}>{FEATURE_LABELS[f] ?? f}</li>)
                ) : (
                  <li>Core bookings, invoices &amp; reminders</li>
                )}
              </ul>

              {isCurrent ? (
                <span className="text-sm font-medium text-primary">Current plan</span>
              ) : subscribed ? (
                // Already on a paid plan — upgrades/downgrades/cancel go through
                // the billing portal so we never create a second subscription.
                <span className="text-xs text-muted-foreground">
                  {key === "starter" ? "Cancel from the billing portal" : "Switch in the billing portal"}
                </span>
              ) : key === "starter" ? (
                <span className="text-xs text-muted-foreground">Manage from the billing portal</span>
              ) : (
                <UpgradeButtons tier={key} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
