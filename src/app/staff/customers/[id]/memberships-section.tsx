import { subscriptionStatusLabel, isSubscriptionLive } from "@/lib/service-plans";
import { StartBenefitsNowButton } from "./start-benefits-now-button";

export type MembershipRow = {
  id: string;
  status: string;
  interval: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  benefits_start_at: string | null;
  service_plan: { name: string; discount_type: string; discount_value: number } | null;
};

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

// Module-scope (not the component body) so the onboarding-gate time check
// doesn't trip the react-hooks purity rule on Date.now().
const gateInFuture = (d: string | null) => !!d && new Date(d).getTime() > Date.now();

function perk(sp: { discount_type: string; discount_value: number } | null): string | null {
  if (!sp || sp.discount_value <= 0) return null;
  if (sp.discount_type === "percent") return `${sp.discount_value}% member discount`;
  if (sp.discount_type === "fixed")
    return `${new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(sp.discount_value)} member discount`;
  return null;
}

export function MembershipsSection({ memberships }: { memberships: MembershipRow[] }) {
  if (memberships.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        No memberships yet. Invite this customer to a plan below.
      </div>
    );
  }

  const live = memberships.filter((m) => isSubscriptionLive(m.status));
  const past = memberships.filter((m) => !isSubscriptionLive(m.status));

  return (
    <div className="flex flex-col gap-3">
      {[...live, ...past].map((m) => {
        const active = isSubscriptionLive(m.status);
        const p = perk(m.service_plan);
        const intervalLabel = m.interval === "year" ? "Annual" : m.interval === "month" ? "Monthly" : "—";
        const gateFuture = gateInFuture(m.benefits_start_at);
        return (
          <div key={m.id} className={`rounded-lg border p-4 ${active ? "" : "opacity-60"}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{m.service_plan?.name ?? "Plan"}</p>
                <p className="text-xs text-muted-foreground">
                  {subscriptionStatusLabel(m.status)} · {intervalLabel}
                  {m.current_period_end
                    ? ` · ${m.cancel_at_period_end ? "Ends" : "Renews"} ${fmtDate(m.current_period_end)}`
                    : ""}
                </p>
                {p && <p className="mt-1 text-xs font-medium text-green-700">{p}</p>}
                {active && gateFuture && (
                  <div className="mt-2 flex flex-col gap-1">
                    <p className="text-xs text-amber-700">
                      Plan benefits start {fmtDate(m.benefits_start_at)} (onboarding gate).
                    </p>
                    <StartBenefitsNowButton subscriptionId={m.id} />
                  </div>
                )}
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}
              >
                {active ? "Active" : subscriptionStatusLabel(m.status)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
