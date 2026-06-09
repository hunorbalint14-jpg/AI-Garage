import { redirect } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/staff/page-header";
import Link from "next/link";
import { RevenueChart } from "./revenue-chart-lazy";

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

export default async function RevenuePage() {
  const ctx = await requireStaffContext();
  if (!ctx.orgRole) redirect("/staff");

  const admin = createAdminClient();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
  const yearStart = new Date(now.getFullYear(), 0, 1).toISOString().split("T")[0];

  const [allInvoicesRes, jobsThisMonthRes] = await Promise.all([
    admin
      .from("invoices")
      .select("id, invoice_number, total, status, issued_at, due_at, paid_at, customer:customers(id, full_name)")
      .eq("location_id", ctx.location.id)
      .order("issued_at", { ascending: false })
      .limit(500),
    admin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("location_id", ctx.location.id)
      .in("status", ["complete", "invoiced"])
      .gte("completed_at", monthStart),
  ]);

  const allInvoices = (allInvoicesRes.data ?? []) as unknown as InvoiceRow[];
  const jobsThisMonth = jobsThisMonthRes.count ?? 0;

  const paidInvoices = allInvoices.filter((i) => i.status === "paid");
  const revenueThisMonth = paidInvoices
    .filter((i) => i.paid_at && i.paid_at >= monthStart)
    .reduce((s, i) => s + i.total, 0);
  const revenueYtd = paidInvoices
    .filter((i) => i.paid_at && i.paid_at >= yearStart)
    .reduce((s, i) => s + i.total, 0);
  const totalRevenue = paidInvoices.reduce((s, i) => s + i.total, 0);
  const avgInvoice = paidInvoices.length > 0 ? totalRevenue / paidInvoices.length : 0;

  const outstanding = allInvoices
    .filter((i) => i.status === "sent" || (i.status !== "paid" && new Date(i.due_at) >= now))
    .reduce((s, i) => s + i.total, 0);
  const overdue = allInvoices
    .filter((i) => i.status !== "paid" && i.status !== "draft" && new Date(i.due_at) < now)
    .reduce((s, i) => s + i.total, 0);

  // Build last 6 months chart data
  const chartData = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    const start = d.toISOString().split("T")[0];
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split("T")[0];
    const revenue = paidInvoices
      .filter((inv) => inv.paid_at && inv.paid_at >= start && inv.paid_at <= end)
      .reduce((s, inv) => s + inv.total, 0);
    return {
      month: d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }),
      revenue,
    };
  });

  const recentInvoices = allInvoices.slice(0, 10);
  const STATUS_STYLE: Record<string, string> = {
    draft: "bg-gray-100 text-gray-600",
    sent: "bg-blue-100 text-blue-700",
    paid: "bg-green-100 text-green-700",
    overdue: "bg-red-100 text-red-700",
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Revenue" description={`Financial overview for ${ctx.location.name}`} />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard label="This month" value={fmt(revenueThisMonth)} accent="green" />
        <StatCard label="Year to date" value={fmt(revenueYtd)} />
        <StatCard label="Outstanding" value={fmt(outstanding)} sub="sent, awaiting payment" accent={outstanding > 0 ? "amber" : undefined} />
        <StatCard label="Overdue" value={fmt(overdue)} accent={overdue > 0 ? "red" : undefined} />
        <StatCard label="Avg invoice" value={fmt(avgInvoice)} sub={`${paidInvoices.length} paid`} />
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
