import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildStatement } from "@/lib/statement";
import { loadStatementData } from "../payment-actions";
import { PrintButton } from "@/app/staff/authorisations/[id]/print-button";

// Account statement (#504 PR 4): opening balance, period activity with a
// running balance, closing balance, aging on outstanding. Print CSS is the
// PDF (the established stance).

const fmt = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
const fmtD = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default async function StatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { id } = await params;
  const { from, to } = await searchParams;
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "invoices")) notFound();
  const admin = createAdminClient();

  const { data: custRow } = await admin
    .from("customers")
    .select("id, organization_id, full_name, email")
    .eq("id", id)
    .maybeSingle();
  const cust = custRow as { id: string; organization_id: string; full_name: string | null; email: string | null } | null;
  if (!cust || cust.organization_id !== ctx.organization.id) notFound();

  // Default period: the current month to date.
  const now = new Date();
  const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const fromIso = from ? new Date(from).toISOString() : defaultFrom;
  const toIso = to ? new Date(to).toISOString() : now.toISOString();

  const data = await loadStatementData(admin, id);
  const s = buildStatement({ ...data, fromIso, toIso });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 print:max-w-none">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link href={`/staff/customers/${id}`} className="text-sm text-muted-foreground underline underline-offset-2">
          ← Back to the customer
        </Link>
        <PrintButton />
      </div>

      <div>
        <h1 className="text-2xl font-bold">Statement of account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {cust.full_name ?? "Customer"} · {ctx.organization.name} — {ctx.location.name} ·{" "}
          {fmtD(fromIso)} – {fmtD(toIso)}
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border print:border-black/30">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Detail</th>
              <th className="px-3 py-2 font-medium text-right">Invoiced</th>
              <th className="px-3 py-2 font-medium text-right">Paid</th>
              <th className="px-3 py-2 font-medium text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t bg-muted/20">
              <td className="px-3 py-2" colSpan={4}>Opening balance</td>
              <td className="px-3 py-2 text-right tabular-nums font-medium">{fmt(s.opening)}</td>
            </tr>
            {s.lines.map((l, i) => (
              <tr key={i} className="border-t">
                <td className="px-3 py-2 whitespace-nowrap">{fmtD(l.date)}</td>
                <td className="px-3 py-2 capitalize">
                  {l.kind === "invoice" ? `Invoice ${l.reference}` : `Payment · ${l.reference}`}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{l.debit !== null ? fmt(l.debit) : ""}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ws-green">{l.credit !== null ? fmt(l.credit) : ""}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(l.balance)}</td>
              </tr>
            ))}
            {s.lines.length === 0 && (
              <tr className="border-t">
                <td className="px-3 py-3 text-muted-foreground" colSpan={5}>No activity in this period.</td>
              </tr>
            )}
            <tr className="border-t-2 bg-muted/20 font-semibold">
              <td className="px-3 py-2" colSpan={4}>Closing balance</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt(s.closing)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <section className="rounded-lg border p-4 print:border-black/30">
        <h2 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ws-text-3">
          Outstanding · aged
        </h2>
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          <div><p className="text-muted-foreground text-xs">Not yet due</p><p className="tabular-nums font-medium">{fmt(s.aging.current)}</p></div>
          <div><p className="text-muted-foreground text-xs">1–30 days</p><p className="tabular-nums font-medium">{fmt(s.aging.d30)}</p></div>
          <div><p className="text-muted-foreground text-xs">31–60 days</p><p className="tabular-nums font-medium text-ws-amber">{fmt(s.aging.d60)}</p></div>
          <div><p className="text-muted-foreground text-xs">60+ days</p><p className="tabular-nums font-medium text-ws-red">{fmt(s.aging.d90)}</p></div>
          <div><p className="text-muted-foreground text-xs">Total outstanding</p><p className="tabular-nums font-semibold">{fmt(s.totalOutstanding)}</p></div>
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        Aging is computed on outstanding amounts (invoice total minus payments allocated), never raw totals.
        Payments allocate to the oldest invoice first.
      </p>
    </div>
  );
}
