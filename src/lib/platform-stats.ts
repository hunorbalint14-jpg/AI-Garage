import { createAdminClient } from "@/lib/supabase/admin";
import { TIERS, tenantBillingActive, type TierKey, type OrgBilling } from "@/lib/tenant-plans";

// One row of the platform_org_overview view — a per-org rollup for the operator
// dashboard. Reads via the service-role client (RLS-bypass); never expose to a
// tenant client.
export type OrgOverviewRow = {
  organization_id: string;
  name: string;
  slug: string;
  created_at: string;
  tenant_plan: string | null;
  tenant_subscription_status: string | null;
  tenant_trial_end: string | null;
  tenant_current_period_end: string | null;
  stripe_charges_enabled: boolean;
  stripe_payouts_enabled: boolean;
  xero_connected: boolean;
  location_count: number;
  staff_count: number;
  customer_count: number;
  vehicle_count: number;
  booking_count: number;
  job_count: number;
  invoice_count: number;
  invoice_paid_count: number;
  revenue_paid_pence: number;
  reminder_sent_count: number;
  quote_count: number;
  ai_input_tokens_30d: number;
  ai_output_tokens_30d: number;
  ai_cost_pence_30d: number;
  ai_events_30d: number;
  last_activity_at: string | null;
};

export async function fetchOrgOverview(): Promise<OrgOverviewRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("platform_org_overview")
    .select("*")
    .order("name", { ascending: true });
  if (error) {
    console.error("[platform-stats] overview query failed", error.message);
    return [];
  }
  return (data ?? []) as OrgOverviewRow[];
}

function billingOf(row: OrgOverviewRow): OrgBilling {
  return {
    tenant_plan: row.tenant_plan,
    tenant_subscription_status: row.tenant_subscription_status,
    tenant_current_period_end: row.tenant_current_period_end,
    tenant_trial_end: row.tenant_trial_end,
  };
}

export type BillingState = "active" | "trialing" | "lapsed" | "free";

// Coarse billing state for the dashboard badge. "free" = Starter (always
// active, no charge); paid tiers are active / trialing / lapsed (past grace).
export function billingState(row: OrgOverviewRow, now: Date = new Date()): BillingState {
  const tier = TIERS[(row.tenant_plan as TierKey) ?? "starter"] ?? TIERS.starter;
  if (tier.key === "starter") return "free";
  if (row.tenant_subscription_status === "trialing" || (row.tenant_trial_end && new Date(row.tenant_trial_end) > now)) {
    return "trialing";
  }
  return tenantBillingActive(billingOf(row), now) ? "active" : "lapsed";
}

export function planName(row: OrgOverviewRow): string {
  return (TIERS[(row.tenant_plan as TierKey) ?? "starter"] ?? TIERS.starter).name;
}

// Normalised monthly recurring revenue for one org, in pence. Only paid tiers in
// good standing contribute. Annual subscribers are approximated at the tier's
// monthly price (interval isn't stored on the org), so this is an estimate.
export function orgMrrPence(row: OrgOverviewRow, now: Date = new Date()): number {
  const tier = TIERS[(row.tenant_plan as TierKey) ?? "starter"] ?? TIERS.starter;
  if (tier.key === "starter") return 0;
  if (!tenantBillingActive(billingOf(row), now)) return 0;
  return tier.monthlyPence;
}

export type PlatformTotals = {
  orgs: number;
  active: number;
  trialing: number;
  lapsed: number;
  free: number;
  locations: number;
  staff: number;
  customers: number;
  vehicles: number;
  invoices: number;
  revenuePaidPence: number;
  mrrPence: number;
  aiCostPence30d: number;
  aiTokens30d: number;
};

export function computeTotals(rows: OrgOverviewRow[], now: Date = new Date()): PlatformTotals {
  const t: PlatformTotals = {
    orgs: rows.length,
    active: 0, trialing: 0, lapsed: 0, free: 0,
    locations: 0, staff: 0, customers: 0, vehicles: 0, invoices: 0,
    revenuePaidPence: 0, mrrPence: 0, aiCostPence30d: 0, aiTokens30d: 0,
  };
  for (const r of rows) {
    t[billingState(r, now)] += 1;
    t.locations += Number(r.location_count);
    t.staff += Number(r.staff_count);
    t.customers += Number(r.customer_count);
    t.vehicles += Number(r.vehicle_count);
    t.invoices += Number(r.invoice_count);
    t.revenuePaidPence += Number(r.revenue_paid_pence);
    t.mrrPence += orgMrrPence(r, now);
    t.aiCostPence30d += Number(r.ai_cost_pence_30d);
    t.aiTokens30d += Number(r.ai_input_tokens_30d) + Number(r.ai_output_tokens_30d);
  }
  return t;
}

// pence → "£1,234.56" (or "£12" for whole pounds with no minor units shown when
// rounded). Used across the admin UI.
export function formatGbp(pence: number, opts: { minor?: boolean } = {}): string {
  const pounds = pence / 100;
  const showMinor = opts.minor ?? pounds % 1 !== 0;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: showMinor ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(pounds);
}
