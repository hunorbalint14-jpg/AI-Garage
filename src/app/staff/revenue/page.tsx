import { redirect } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/staff/page-header";
import Link from "next/link";
import { RevenueChart } from "./revenue-chart-lazy";
import { FinanceScopeToggle } from "@/components/staff/finance-scope-toggle";

type InvoiceRow = {
  id: string;
  invoice_number: string;
  total: number;
  status: string;
  issued_at: string;
  due_at: string;
  paid_at: string | null;
  customer: { id: string; full_name: string | null } | null;
};

// Shape returned by the revenue_stats SQL function (see migration
// 20260610100000_revenue_stats.sql). Aggregates are computed in the database
// so they stay exact at any invoice volume.
type RevenueStats = {
  revenue_this_month: number;
  revenue_ytd: number;
  total_paid: number;
  paid_count: number;
  outstanding: number;
  overdue: number;
  monthly_revenue: { month_start: string; revenue: number }[];
};

const EMPTY_STATS: RevenueStats = {
  revenue_this_month: 0,
  revenue_ytd: 0,
  total_paid: 0,
  paid_count: 0,
  outstanding: 0,
  overdue: 0,
  monthly_revenue: [],
};

function fmt(n: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "green" | "amber" | "red" }) {
  const colours = { green: "text-green-700", amber: "text-amber-600", red: "text-red-600" };
  return (
    <div className="rounded-xl border p-5 bg-card">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${accent ? colours[accent] : ""}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export default async function RevenuePage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const ctx = await requireStaffContext();
  if (!ctx.orgRole) redirect("/staff");

  // Org roles default to the all-locations roll-up; ?scope=<locationId> drops to
  // a specific branch (any accessible branch, not just the active one).
  const { scope } = await searchParams;
  const accessibleIds = new Set(ctx.accessibleLocations.map((l) => l.id));
  const selectedBranch = scope && scope !== "all" && accessibleIds.has(scope) ? scope : null;
  const orgWide = !selectedBranch;
  const branchId = selectedBranch ?? ctx.location.id;
  const branchName = ctx.accessibleLocations.find((l) => l.id === branchId)?.name ?? ctx.location.name;
  const locationIds = ctx.accessibleLocations.map((l) => l.id);

  const admin = createAdminClient();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];

  const [statsRes, recentInvoicesRes, jobsThisMonthRes] = await Promise.all([
    orgWide
      ? admin.rpc("revenue_stats_org", { p_organization_id: ctx.organization.id }).single()
      : admin.rpc("revenue_stats", { p_location_id: branchId }).single(),
    (orgWide
      ? admin
          .from("invoices")
          .select("id, invoice_number, total, status, issued_at, due_at, paid_at, customer:customers(id, full_name)")
          .eq("organization_id", ctx.organization.id)
      : admin
          .from("invoices")
          .select("id, invoice_number, total, status, issued_at, due_at, paid_at, customer:customers(id, full_name)")
          .eq("location_id", branchId)
    )
      .order("issued_at", { ascending: false })
      .limit(10),
    (orgWide
      ? admin.from("jobs").select("id", { count: "exact", head: true }).in("location_id", locationIds)
      : admin.from("jobs").select("id", { count: "exact", head: true }).eq("location_id", branchId)
    )
      .in("status", ["complete", "invoiced"])
      .gte("completed_at", monthStart),
  ]);

  const stats = (statsRes.data ?? EMPTY_STATS) as RevenueStats;
  const recentInvoices = (recentInvoicesRes.data ?? []) as unknown as InvoiceRow[];
  const jobsThisMonth = jobsThisMonthRes.count ?? 0;

  const revenueThisMonth = Number(stats.revenue_this_month);
  const revenueYtd = Number(stats.revenue_ytd);
  const paidCount = Number(stats.paid_count);
  const avgInvoice = paidCount > 0 ? Number(stats.total_paid) / paidCount : 0;
  const outstanding = Number(stats.outstanding);
  const overdue = Number(stats.overdue);

  const chartData = stats.monthly_revenue.map((m) => ({
    // month_start is a plain YYYY-MM-DD; parse as UTC to avoid TZ drift.
    month: new Date(`${m.month_start}T00:00:00Z`).toLocaleDateString("en-GB", {
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    }),
    revenue: Number(m.revenue),
  }));
  const STATUS_STYLE: Record<string, string> = {
    draft: "bg-gray-100 text-gray-600",
    sent: "bg-blue-100 text-blue-700",
    paid: "bg-green-100 text-green-700",
    overdue: "bg-red-100 text-red-700",
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Revenue"
        description={orgWide ? "Financial overview across all branches" : `Financial overview for ${branchName}`}
      />
      {ctx.accessibleLocations.length > 1 && <FinanceScopeToggle locations={ctx.accessibleLocations} />}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard label="This month" value={fmt(revenueThisMonth)} accent="green" />
        <StatCard label="Year to date" value={fmt(revenueYtd)} />
        <StatCard label="Outstanding" value={fmt(outstanding)} sub="sent, awaiting payment" accent={outstanding > 0 ? "amber" : undefined} />
        <StatCard label="Overdue" value={fmt(overdue)} accent={overdue > 0 ? "red" : undefined} />
        <StatCard label="Avg invoice" value={fmt(avgInvoice)} sub={`${paidCount} paid`} />
      </div>

      <section>
        <h2 className="mb-3 text-base font-semibold">Monthly revenue — last 6 months</h2>
        <div className="rounded-xl border p-4 bg-card">
          <RevenueChart data={chartData} />
        </div>
      </section>

      <div className="grid sm:grid-cols-2 gap-6">
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold">Recent invoices</h2>
            <Link href="/staff/invoices" className="text-sm underline text-muted-foreground">
              View all
            </Link>
          </div>
          {recentInvoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invoices yet.</p>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Customer</th>
                    <th className="px-3 py-2 font-medium text-right">Total</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentInvoices.map((inv) => {
                    const computedStatus =
                      inv.status !== "paid" && new Date(inv.due_at) < now ? "overdue" : inv.status;
                    return (
                      <tr key={inv.id} className="border-t">
                        <td className="px-3 py-2">
                          <Link href={`/staff/invoices/${inv.id}`} className="underline">
                            {inv.customer?.full_name ?? "—"}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">{fmt(inv.total)}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[computedStatus] ?? ""}`}>
                            {computedStatus}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-base font-semibold">This month</h2>
          <div className="rounded-xl border p-5 bg-card flex flex-col gap-4">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Jobs completed</p>
              <p className="text-3xl font-bold mt-1">{jobsThisMonth}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Revenue collected</p>
              <p className="text-3xl font-bold mt-1 text-green-700">{fmt(revenueThisMonth)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total invoiced (YTD)</p>
              <p className="text-3xl font-bold mt-1">{fmt(revenueYtd)}</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
