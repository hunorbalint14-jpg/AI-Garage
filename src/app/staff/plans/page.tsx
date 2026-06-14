import { redirect } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/staff/page-header";
import { PlansManager, type PlanRow, type ServiceOption } from "./plans-manager";

export default async function PlansPage() {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "services")) redirect("/staff");

  const admin = createAdminClient();
  const [plansRes, orgRes, subsRes, servicesRes] = await Promise.all([
    admin
      .from("service_plans")
      .select(
        "id, name, description, price_monthly_pence, price_annual_pence, stripe_product_id, stripe_price_monthly_id, stripe_price_annual_id, active, discount_type, discount_value",
      )
      .eq("organization_id", ctx.organization.id)
      .order("active", { ascending: false })
      .order("name", { ascending: true }),
    admin
      .from("organizations")
      .select("stripe_account_id, stripe_charges_enabled")
      .eq("id", ctx.organization.id)
      .maybeSingle(),
    admin
      .from("plan_subscriptions")
      .select("service_plan_id, status")
      .eq("organization_id", ctx.organization.id)
      .in("status", ["active", "trialing", "past_due"]),
    admin
      .from("services")
      .select("id, name")
      .eq("location_id", ctx.location.id)
      .eq("active", true)
      .order("name", { ascending: true }),
  ]);

  const counts = new Map<string, number>();
  for (const s of (subsRes.data ?? []) as { service_plan_id: string | null; status: string }[]) {
    if (s.service_plan_id) counts.set(s.service_plan_id, (counts.get(s.service_plan_id) ?? 0) + 1);
  }

  const planIds = ((plansRes.data ?? []) as { id: string }[]).map((p) => p.id);
  const { data: itemRows } = planIds.length
    ? await admin
        .from("service_plan_items")
        .select("service_plan_id, service_id, quantity_per_period")
        .in("service_plan_id", planIds)
    : { data: [] };
  const includedByPlan = new Map<string, { service_id: string; quantity_per_period: number }[]>();
  for (const it of (itemRows ?? []) as { service_plan_id: string; service_id: string; quantity_per_period: number }[]) {
    const list = includedByPlan.get(it.service_plan_id) ?? [];
    list.push({ service_id: it.service_id, quantity_per_period: Number(it.quantity_per_period) });
    includedByPlan.set(it.service_plan_id, list);
  }

  const services = (servicesRes.data ?? []) as ServiceOption[];

  const plans = ((plansRes.data ?? []) as Omit<PlanRow, "subscriberCount" | "included">[]).map((p) => ({
    ...p,
    subscriberCount: counts.get(p.id) ?? 0,
    included: includedByPlan.get(p.id) ?? [],
  }));

  const org = orgRes.data as { stripe_account_id: string | null; stripe_charges_enabled: boolean | null } | null;
  const connectReady = !!org?.stripe_account_id && !!org?.stripe_charges_enabled;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Service plans"
        description="Recurring maintenance memberships customers can subscribe to. Billed via Stripe on your connected account."
      />

      {!connectReady && (
        <div className="rounded-lg border border-amber-300/40 bg-amber-500/10 p-4 text-sm text-amber-700">
          Finish Stripe payment setup (Settings → Payments) before customers can subscribe. You can still draft plans now.
        </div>
      )}

      <PlansManager plans={plans} services={services} />
    </div>
  );
}
