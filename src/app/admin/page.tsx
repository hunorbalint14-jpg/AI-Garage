import {
  fetchOrgOverview,
  computeTotals,
  billingState,
  planName,
  orgMrrPence,
  formatGbp,
} from "@/lib/platform-stats";
import { OrgTable, type AdminOrgRow } from "@/components/admin/org-table";


function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-[#23272f] bg-[#15181d] px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-[#5a6170]">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-white">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-[#9aa1ad]">{sub}</div>}
    </div>
  );
}

export default async function AdminOverviewPage() {
  const rows = await fetchOrgOverview();
  const totals = computeTotals(rows);

  const tableRows: AdminOrgRow[] = rows.map((r) => ({
    id: r.organization_id,
    name: r.name,
    slug: r.slug,
    plan: planName(r),
    billing: billingState(r),
    locations: Number(r.location_count),
    staff: Number(r.staff_count),
    customers: Number(r.customer_count),
    invoices: Number(r.invoice_count),
    revenuePence: Number(r.revenue_paid_pence),
    mrrPence: orgMrrPence(r),
    aiCostPence30d: Number(r.ai_cost_pence_30d),
    stripe: r.stripe_charges_enabled,
    xero: r.xero_connected,
    lastActivity: r.last_activity_at,
  }));

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[12.5px] text-[#9aa1ad]">All organisations across AI Garage.</p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        <Kpi
          label="Organisations"
          value={String(totals.orgs)}
          sub={`${totals.active} active · ${totals.trialing} trial · ${totals.lapsed} lapsed · ${totals.free} free`}
        />
        <Kpi label="MRR (est.)" value={formatGbp(totals.mrrPence)} sub="Normalised monthly" />
        <Kpi label="AI spend (30d)" value={formatGbp(totals.aiCostPence30d, { minor: true })} sub={`${totals.aiTokens30d.toLocaleString("en-GB")} tokens`} />
        <Kpi label="Paid revenue" value={formatGbp(totals.revenuePaidPence)} sub="All invoices ever" />
        <Kpi label="Locations" value={String(totals.locations)} />
        <Kpi label="Staff" value={String(totals.staff)} />
        <Kpi label="Customers" value={totals.customers.toLocaleString("en-GB")} sub={`${totals.vehicles.toLocaleString("en-GB")} vehicles`} />
        <Kpi label="Invoices" value={totals.invoices.toLocaleString("en-GB")} />
      </div>

      <OrgTable rows={tableRows} />
    </div>
  );
}
