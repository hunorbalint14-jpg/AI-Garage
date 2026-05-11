import Link from "next/link";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/staff/page-header";
import { InvoiceSearch } from "./invoice-search";

export const dynamic = "force-dynamic";

type InvoiceRow = {
  id: string;
  invoice_number: string;
  status: string;
  total: number;
  issued_at: string;
  due_at: string;
  paid_at: string | null;
  customer: { id: string; full_name: string | null } | null;
};

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  sent: "bg-blue-100 text-blue-700",
  paid: "bg-green-100 text-green-700",
  overdue: "bg-red-100 text-red-700",
};

function fmt(n: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();
  const { q } = await searchParams;
  const query = q?.trim() ?? "";

  let invoices: InvoiceRow[] | null = null;

  if (query) {
    const [byNumberRes, custRes] = await Promise.all([
      admin
        .from("invoices")
        .select("id, invoice_number, status, total, issued_at, due_at, paid_at, customer:customers(id, full_name)")
        .eq("location_id", ctx.location.id)
        .ilike("invoice_number", `%${query}%`)
        .order("created_at", { ascending: false })
        .limit(200),
      admin
        .from("customers")
        .select("id")
        .eq("location_id", ctx.location.id)
        .ilike("full_name", `%${query}%`),
    ]);

    const byNumber = (byNumberRes.data ?? []) as InvoiceRow[];
    const customerIds = (custRes.data ?? []).map((c: { id: string }) => c.id);
    const existingIds = new Set(byNumber.map((i) => i.id));

    let byCustomer: InvoiceRow[] = [];
    if (customerIds.length > 0) {
      const { data } = await admin
        .from("invoices")
        .select("id, invoice_number, status, total, issued_at, due_at, paid_at, customer:customers(id, full_name)")
        .eq("location_id", ctx.location.id)
        .in("customer_id", customerIds)
        .order("created_at", { ascending: false })
        .limit(200);
      byCustomer = ((data ?? []) as InvoiceRow[]).filter((i) => !existingIds.has(i.id));
    }

    invoices = [...byNumber, ...byCustomer];
  } else {
    const { data } = await admin
      .from("invoices")
      .select("id, invoice_number, status, total, issued_at, due_at, paid_at, customer:customers(id, full_name)")
      .eq("location_id", ctx.location.id)
      .order("created_at", { ascending: false })
      .limit(200);
    invoices = data as InvoiceRow[] | null;
  }

  const rows = (invoices ?? []).map((inv) => {
    const status =
      inv.status !== "paid" && new Date(inv.due_at) < new Date() ? "overdue" : inv.status;
    return { ...inv, computedStatus: status };
  });

  const totalOwed = rows.filter((r) => r.computedStatus === "sent" || r.computedStatus === "overdue").reduce((s, r) => s + r.total, 0);
  const totalPaid = rows.filter((r) => r.computedStatus === "paid").reduce((s, r) => s + r.total, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Invoices"
        description="All invoices raised at this location."
      />

      <InvoiceSearch initialQ={query} />

      {!query && rows.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Outstanding</p>
            <p className="text-2xl font-bold text-amber-600">{fmt(totalOwed)}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Received</p>
            <p className="text-2xl font-bold text-green-700">{fmt(totalPaid)}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total invoices</p>
            <p className="text-2xl font-bold">{rows.length}</p>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          {query ? `No invoices found for "${query}".` : "No invoices yet. Complete a job and create an invoice from the job card."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          {query && (
            <div className="border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
              {rows.length} result{rows.length !== 1 ? "s" : ""} for &ldquo;{query}&rdquo;
            </div>
          )}
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Number</th>
                <th className="px-4 py-2 font-medium">Customer</th>
                <th className="px-4 py-2 font-medium">Issued</th>
                <th className="px-4 py-2 font-medium">Due</th>
                <th className="px-4 py-2 font-medium text-right">Total</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((inv) => (
                <tr key={inv.id} className="border-t">
                  <td className="px-4 py-2 font-mono">{inv.invoice_number}</td>
                  <td className="px-4 py-2">
                    {inv.customer ? (
                      <Link href={`/staff/customers/${inv.customer.id}`} className="underline">
                        {inv.customer.full_name ?? "Unknown"}
                      </Link>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {new Date(inv.issued_at).toLocaleDateString("en-GB")}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {new Date(inv.due_at).toLocaleDateString("en-GB")}
                  </td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">
                    {fmt(inv.total)}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[inv.computedStatus] ?? ""}`}>
                      {inv.computedStatus}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link href={`/staff/invoices/${inv.id}`} className="underline text-sm">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
