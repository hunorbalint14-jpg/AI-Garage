import { Repeat } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortalContext } from "@/lib/portal-auth";
import { subscriptionStatusLabel, isSubscriptionLive } from "@/lib/service-plans";
import { PortalShell } from "../portal-shell";
import { SubscribeButtons, CancelButton } from "./plans-client";

type PlanRow = {
  id: string;
  name: string;
  description: string | null;
  price_monthly_pence: number | null;
  price_annual_pence: number | null;
  discount_type: "none" | "percent" | "fixed";
  discount_value: number;
};

function discountLabel(p: { discount_type: string; discount_value: number }): string | null {
  if (p.discount_type === "percent" && p.discount_value > 0) return `${p.discount_value}% off your invoices`;
  if (p.discount_type === "fixed" && p.discount_value > 0)
    return `${new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(p.discount_value)} off your invoices`;
  return null;
}
type SubRow = {
  id: string;
  service_plan_id: string | null;
  status: string;
  interval: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

const fmt = (pence: number | null) =>
  pence == null ? null : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);
// Invoice amounts (discount/credit) are stored in pounds, not pence.
const fmtGbp = (pounds: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pounds);
const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

export default async function PlansPage({
  searchParams,
}: {
  searchParams: Promise<{ subscribed?: string }>;
}) {
  const { subscribed } = await searchParams;
  const { location, customer } = await getPortalContext();
  const org = location.organization;

  if (!customer) {
    return (
      <PortalShell org={org}>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center backdrop-blur-sm">
          <p className="font-semibold">No account found</p>
          <p className="mt-2 text-sm text-gray-400">{`We couldn't find a customer record linked to your email. Please contact ${org.name}.`}</p>
        </div>
      </PortalShell>
    );
  }

  const admin = createAdminClient();
  const [plansRes, subsRes] = await Promise.all([
    admin
      .from("service_plans")
      .select("id, name, description, price_monthly_pence, price_annual_pence, discount_type, discount_value")
      .eq("location_id", location.id)
      .eq("active", true)
      .order("name", { ascending: true }),
    admin
      .from("plan_subscriptions")
      .select("id, service_plan_id, status, interval, current_period_end, cancel_at_period_end")
      .eq("location_id", location.id)
      .eq("customer_id", customer.id)
      .order("created_at", { ascending: false }),
  ]);

  const plans = (plansRes.data ?? []) as PlanRow[];
  const subs = (subsRes.data ?? []) as SubRow[];
  const planName = new Map(plans.map((p) => [p.id, p.name]));

  const planIds = plans.map((p) => p.id);
  const { data: itemRows } = planIds.length
    ? await admin
        .from("service_plan_items")
        .select("service_plan_id, service_id, quantity_per_period, service:services(name)")
        .in("service_plan_id", planIds)
    : { data: [] };
  const includedByPlan = new Map<string, string[]>();
  const includedDetailByPlan = new Map<string, { serviceId: string; name: string; quantity: number }[]>();
  for (const it of (itemRows ?? []) as unknown as {
    service_plan_id: string;
    service_id: string;
    quantity_per_period: number;
    service: { name: string } | null;
  }[]) {
    const name = it.service?.name ?? "service";
    const list = includedByPlan.get(it.service_plan_id) ?? [];
    list.push(`${it.quantity_per_period}× ${name}`);
    includedByPlan.set(it.service_plan_id, list);

    const detail = includedDetailByPlan.get(it.service_plan_id) ?? [];
    detail.push({ serviceId: it.service_id, name, quantity: Number(it.quantity_per_period) });
    includedDetailByPlan.set(it.service_plan_id, detail);
  }

  const liveByPlan = new Map<string, SubRow>();
  for (const s of subs) {
    if (s.service_plan_id && isSubscriptionLive(s.status) && !liveByPlan.has(s.service_plan_id)) {
      liveByPlan.set(s.service_plan_id, s);
    }
  }
  const memberships = [...liveByPlan.values()];

  // Per-membership: how much of each included service is left this period, plus
  // the running £ saved through membership credits + discounts on past invoices.
  type RemainingItem = { name: string; remaining: number; total: number };
  const [remainingResults, savedRes] = await Promise.all([
    Promise.all(
      memberships.map(async (s): Promise<readonly [string, RemainingItem[]]> => {
        const detail = s.service_plan_id ? includedDetailByPlan.get(s.service_plan_id) : undefined;
        if (!detail || detail.length === 0 || !s.current_period_end) return [s.id, []] as const;
        const { data: used } = await admin
          .from("plan_service_usage")
          .select("service_id, covered_qty")
          .eq("plan_subscription_id", s.id)
          .eq("period_end", s.current_period_end);
        const usedMap = new Map<string, number>();
        for (const u of (used ?? []) as { service_id: string; covered_qty: number }[]) {
          usedMap.set(u.service_id, (usedMap.get(u.service_id) ?? 0) + Number(u.covered_qty));
        }
        const remaining = detail.map((d) => ({
          name: d.name,
          total: d.quantity,
          remaining: Math.max(0, d.quantity - (usedMap.get(d.serviceId) ?? 0)),
        }));
        return [s.id, remaining] as const;
      }),
    ),
    admin
      .from("invoices")
      .select("discount_amount, membership_credit_amount")
      .eq("location_id", location.id)
      .eq("customer_id", customer.id),
  ]);
  const remainingBySub = new Map<string, RemainingItem[]>(remainingResults);
  const totalSaved = (
    (savedRes.data ?? []) as { discount_amount: number | null; membership_credit_amount: number | null }[]
  ).reduce((sum, r) => sum + Number(r.discount_amount ?? 0) + Number(r.membership_credit_amount ?? 0), 0);

  return (
    <PortalShell org={org}>
      <div>
        <h1 className="text-2xl font-bold">Plans</h1>
        <p className="mt-1 text-sm text-gray-400">Maintenance memberships from {org.name}.</p>
      </div>

      {subscribed && (
        <div className="rounded-2xl border border-green-500/20 bg-green-500/10 p-4 text-sm text-green-300">
          You are subscribed. It can take a moment to show below.
        </div>
      )}

      {memberships.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">Your memberships</h2>
          {totalSaved > 0 && (
            <p className="mb-3 text-sm text-gray-400">
              You&rsquo;ve saved{" "}
              <span className="font-semibold" style={{ color: org.primary_color }}>{fmtGbp(totalSaved)}</span>{" "}
              so far with your membership.
            </p>
          )}
          <div className="flex flex-col gap-2">
            {memberships.map((s) => {
              const remaining = remainingBySub.get(s.id) ?? [];
              return (
                <div key={s.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">
                        {s.service_plan_id ? (planName.get(s.service_plan_id) ?? "Plan") : "Plan"}
                      </p>
                      <p className="text-xs text-gray-400">
                        {subscriptionStatusLabel(s.status)} · {s.interval === "year" ? "Annual" : "Monthly"} ·{" "}
                        {s.cancel_at_period_end
                          ? `Ends ${fmtDate(s.current_period_end)}`
                          : `Renews ${fmtDate(s.current_period_end)}`}
                      </p>
                    </div>
                    {!s.cancel_at_period_end && <CancelButton subscriptionId={s.id} />}
                  </div>

                  {remaining.length > 0 && (
                    <div className="mt-3 border-t border-white/10 pt-3">
                      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
                        Included this period
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {remaining.map((it, i) => (
                          <span
                            key={i}
                            className={`rounded-lg border px-2.5 py-1 text-xs ${
                              it.remaining > 0
                                ? "border-white/10 bg-white/[0.04] text-gray-300"
                                : "border-white/5 text-gray-500"
                            }`}
                          >
                            {it.name}: <span className="font-semibold tabular-nums">{it.remaining}</span> of {it.total} left
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">Available plans</h2>
        {plans.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-gray-400 backdrop-blur-sm">
            {org.name} has no membership plans yet.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {plans.map((p) => {
              const live = liveByPlan.get(p.id);
              const monthly = fmt(p.price_monthly_pence);
              const annual = fmt(p.price_annual_pence);
              return (
                <div
                  key={p.id}
                  className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-sm"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <div
                        className="flex h-9 w-9 items-center justify-center rounded-xl"
                        style={{ backgroundColor: `${org.primary_color}25` }}
                      >
                        <Repeat className="h-4 w-4" style={{ color: org.primary_color }} />
                      </div>
                      <h3 className="font-semibold">{p.name}</h3>
                    </div>
                    {p.description && <p className="mt-2 text-sm text-gray-400">{p.description}</p>}
                    {discountLabel(p) && (
                      <p className="mt-2 text-sm font-medium" style={{ color: org.primary_color }}>
                        {discountLabel(p)}
                      </p>
                    )}
                    {(includedByPlan.get(p.id)?.length ?? 0) > 0 && (
                      <p className="mt-2 text-sm text-gray-400">
                        Includes {includedByPlan.get(p.id)!.join(", ")} per period
                      </p>
                    )}
                  </div>
                  {live ? (
                    <p className="text-sm font-medium" style={{ color: org.primary_color }}>
                      Current plan
                    </p>
                  ) : (
                    <SubscribeButtons planId={p.id} orgColor={org.primary_color} monthly={monthly} annual={annual} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </PortalShell>
  );
}
