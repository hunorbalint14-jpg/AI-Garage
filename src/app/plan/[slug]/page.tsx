import { Repeat } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyPlanInviteAccess } from "@/lib/plan-invites";
import { SubscribeButtons } from "./subscribe-buttons";

const fmt = (pence: number | null) =>
  pence == null ? null : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);

function Shell({ color, children }: { color?: string; children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen bg-[#050c1a] text-white">
      <main className="relative z-10 mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 py-12">
        <div className="w-full rounded-2xl border border-white/10 bg-white/[0.03] p-8 backdrop-blur-md shadow-2xl">
          <div
            className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl"
            style={{ backgroundColor: `${color ?? "#6366f1"}25` }}
          >
            <Repeat className="h-5 w-5" style={{ color: color ?? "#6366f1" }} />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

export default async function PlanInvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { slug } = await params;
  const { t } = await searchParams;

  const verified = await verifyPlanInviteAccess(slug, t ?? null);
  if (!verified.ok) {
    return (
      <Shell>
        <h1 className="text-xl font-bold">Link no longer valid</h1>
        <p className="mt-2 text-sm text-gray-400">
          This plan invite has expired or already been used. Ask the garage to send a new one.
        </p>
      </Shell>
    );
  }

  const invite = verified.invite;
  const admin = createAdminClient();
  const [planRes, locRes] = await Promise.all([
    admin
      .from("service_plans")
      .select("id, name, description, price_monthly_pence, price_annual_pence, active, discount_type, discount_value")
      .eq("id", invite.service_plan_id)
      .maybeSingle(),
    admin
      .from("locations")
      .select("name, organization:organizations(name, primary_color, logo_url)")
      .eq("id", invite.location_id)
      .maybeSingle(),
  ]);

  const plan = planRes.data as
    | {
        id: string;
        name: string;
        description: string | null;
        price_monthly_pence: number | null;
        price_annual_pence: number | null;
        active: boolean;
        discount_type: "none" | "percent" | "fixed";
        discount_value: number;
      }
    | null;
  const loc = locRes.data as unknown as {
    name: string;
    organization: { name: string; primary_color: string; logo_url: string | null } | null;
  } | null;
  const org = loc?.organization;

  if (!plan || !plan.active || !org) {
    return (
      <Shell color={org?.primary_color}>
        <h1 className="text-xl font-bold">Plan unavailable</h1>
        <p className="mt-2 text-sm text-gray-400">This plan is no longer offered. Please contact the garage.</p>
      </Shell>
    );
  }

  const color = org.primary_color;
  const monthly = fmt(plan.price_monthly_pence);
  const annual = fmt(plan.price_annual_pence);
  const perk =
    plan.discount_type === "percent" && plan.discount_value > 0
      ? `${plan.discount_value}% off your invoices`
      : plan.discount_type === "fixed" && plan.discount_value > 0
        ? `${fmt(Math.round(plan.discount_value * 100))} off your invoices`
        : null;

  return (
    <Shell color={color}>
      <p className="text-xs uppercase tracking-wider text-gray-500">{org.name}</p>
      <h1 className="mt-1 text-2xl font-bold">{plan.name}</h1>
      {plan.description && <p className="mt-2 text-sm text-gray-400">{plan.description}</p>}
      {perk && <p className="mt-2 text-sm font-medium" style={{ color }}>{perk}</p>}

      <div className="mt-4 mb-6 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-300">
        {monthly && <span>{monthly} / month</span>}
        {annual && <span>{annual} / year</span>}
      </div>

      <SubscribeButtons slug={slug} token={t ?? ""} orgColor={color} monthly={monthly} annual={annual} />

      <p className="mt-6 text-xs text-gray-500">
        Secure card payment via Stripe. You can cancel anytime from your account.
      </p>
    </Shell>
  );
}
