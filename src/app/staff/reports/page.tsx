import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/staff/page-header";
import { listLocationStaff } from "@/lib/staff-directory";
import { labourEstimateMinutes, formatMinutes } from "@/lib/time-tracking";
import {
  summariseAgedDebtors,
  rollupProductivity,
  vatSummary,
  periodRange,
  AGED_BUCKETS,
  PERIODS,
  type AgedBucketKey,
  type TimeEntryLite,
} from "@/lib/reports";
import { PeriodSelector } from "./period-selector";

export const dynamic = "force-dynamic";

const fmt = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

const BUCKET_LABEL: Record<AgedBucketKey, string> = {
  current: "Not due",
  "1-30": "1–30 days",
  "31-60": "31–60 days",
  "60+": "60+ days",
};
const BUCKET_ACCENT: Record<AgedBucketKey, string> = {
  current: "",
  "1-30": "text-amber-600",
  "31-60": "text-orange-600",
  "60+": "text-red-600",
};

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${accent ?? ""}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "reports")) {
    return <p className="text-sm text-muted-foreground">You don&apos;t have access to reports.</p>;
  }

  const { period = "this_quarter" } = await searchParams;
  const now = new Date();
  const { from, to, key } = periodRange(period, now);
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const periodLabel = PERIODS.find((p) => p.key === key)?.label ?? "This quarter";

  const admin = createAdminClient();

  const [unpaidRes, paidRes, entriesRes, staff] = await Promise.all([
    admin
      .from("invoices")
      .select("id, invoice_number, total, due_at, customer:customers(full_name)")
      .eq("location_id", ctx.location.id)
      .eq("status", "sent")
      .order("due_at", { ascending: true }),
    admin
      .from("invoices")
      .select("subtotal, vat_amount, total")
      .eq("location_id", ctx.location.id)
      .eq("status", "paid")
      .gte("paid_at", fromIso)
      .lt("paid_at", toIso),
    admin
      .from("job_time_entries")
      .select("user_id, job_id, duration_minutes")
      .eq("location_id", ctx.location.id)
      .not("duration_minutes", "is", null)
      .gte("started_at", fromIso)
      .lt("started_at", toIso),
    listLocationStaff(ctx.location.id, ctx.organization.id),
  ]);

  // --- Aged debtors ---
  type UnpaidRow = { id: string; invoice_number: string; total: number; due_at: string | null; customer: { full_name: string | null } | null };
  const unpaid = (unpaidRes.data ?? []) as unknown as UnpaidRow[];
  const aged = summariseAgedDebtors(unpaid.map((i) => ({ total: i.total, due_at: i.due_at })), now);
  const totalOutstanding = AGED_BUCKETS.reduce((s, k) => s + aged[k].total, 0);

  // --- VAT ---
  const vat = vatSummary((paidRes.data ?? []) as { subtotal: number; vat_amount: number; total: number }[]);

  // --- Productivity ---
  const entries = (entriesRes.data ?? []) as { user_id: string; job_id: string; duration_minutes: number }[];
  const jobIds = [...new Set(entries.map((e) => e.job_id))];
  const estimateByJob = new Map<string, number>();
  if (jobIds.length > 0) {
    const { data: labourItems } = await admin
      .from("job_items")
      .select("job_id, type, quantity")
      .in("job_id", jobIds)
      .eq("type", "labour");
    const grouped = new Map<string, { type: string; quantity: number }[]>();
    for (const it of (labourItems ?? []) as { job_id: string; type: string; quantity: number }[]) {
      if (!grouped.has(it.job_id)) grouped.set(it.job_id, []);
      grouped.get(it.job_id)!.push({ type: it.type, quantity: it.quantity });
    }
    for (const jid of jobIds) estimateByJob.set(jid, labourEstimateMinutes(grouped.get(jid) ?? []));
  }
  const lite: TimeEntryLite[] = entries.map((e) => ({ userId: e.user_id, jobId: e.job_id, minutes: e.duration_minutes }));
  const productivity = rollupProductivity(lite, estimateByJob);
  const nameMap = new Map(staff.map((s) => [s.id, s.name]));
  const prodRows = [...productivity.entries()]
    .map(([userId, row]) => ({ name: nameMap.get(userId) ?? "Staff", ...row }))
    .sort((a, b) => b.actualMinutes - a.actualMinutes);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Reports" description="Outstanding money, labour productivity, and VAT — for this location." />

      {/* Aged debtors */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Aged debtors</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {AGED_BUCKETS.map((k) => (
            <StatCard key={k} label={BUCKET_LABEL[k]} value={fmt(aged[k].total)} sub={`${aged[k].count} invoice${aged[k].count === 1 ? "" : "s"}`} accent={BUCKET_ACCENT[k]} />
          ))}
        </div>
        <p className="text-sm text-muted-foreground">Total outstanding: <span className="font-semibold tabular-nums text-foreground">{fmt(totalOutstanding)}</span></p>
        {unpaid.length > 0 && (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Invoice</th>
                  <th className="px-3 py-2 font-medium">Customer</th>
                  <th className="px-3 py-2 font-medium">Due</th>
                  <th className="px-3 py-2 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {unpaid.map((i) => (
                  <tr key={i.id} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{i.invoice_number}</td>
                    <td className="px-3 py-2">{i.customer?.full_name ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{i.due_at ? new Date(i.due_at).toLocaleDateString("en-GB") : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(i.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Period-scoped reports */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Period: {periodLabel}</h2>
        <PeriodSelector current={key} />
      </div>

      {/* VAT */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">VAT summary</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Net (ex VAT)" value={fmt(vat.net)} sub={`${vat.count} paid invoice${vat.count === 1 ? "" : "s"}`} />
          <StatCard label="VAT collected" value={fmt(vat.vat)} accent="text-amber-600" />
          <StatCard label="Gross" value={fmt(vat.gross)} />
        </div>
      </section>

      {/* Technician productivity */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">Technician productivity</h3>
        {prodRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No clocked time in this period.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Technician</th>
                  <th className="px-3 py-2 font-medium text-right">Jobs</th>
                  <th className="px-3 py-2 font-medium text-right">Actual</th>
                  <th className="px-3 py-2 font-medium text-right">Estimate</th>
                  <th className="px-3 py-2 font-medium text-right">Variance</th>
                </tr>
              </thead>
              <tbody>
                {prodRows.map((r) => {
                  const variance = r.actualMinutes - r.estimateMinutes;
                  const over = r.estimateMinutes > 0 && variance > 0;
                  return (
                    <tr key={r.name} className="border-t">
                      <td className="px-3 py-2">{r.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.jobCount}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMinutes(r.actualMinutes)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.estimateMinutes > 0 ? formatMinutes(r.estimateMinutes) : "—"}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${over ? "text-amber-600" : variance < 0 ? "text-green-700" : ""}`}>
                        {r.estimateMinutes > 0 ? `${variance >= 0 ? "+" : "−"}${formatMinutes(Math.abs(variance))}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
