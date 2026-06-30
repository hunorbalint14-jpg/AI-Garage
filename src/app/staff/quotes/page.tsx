import Link from "next/link";
import { Plus } from "lucide-react";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/staff/page-header";
import { Button } from "@/components/ui/button";
import { QuoteFilters } from "./quote-filters";

export const dynamic = "force-dynamic";

type QuoteRow = {
  id: string;
  slug: string | null;
  status: string;
  title: string | null;
  total: number;
  created_at: string;
  sent_at: string | null;
  expires_at: string | null;
  responded_at: string | null;
  viewed_count: number;
  customer: { id: string; full_name: string | null } | null;
  vehicle: { registration: string | null } | null;
};

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-green-700",
  declined: "bg-red-100 text-red-700",
  expired: "bg-gray-200 text-gray-700",
  cancelled: "bg-gray-200 text-gray-700",
  approved_after_close: "bg-purple-100 text-purple-700",
};

const STATUSES = ["draft", "pending", "approved", "declined", "expired", "cancelled"] as const;

function fmt(n: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();
  const { q, status } = await searchParams;
  const query = q?.trim() ?? "";
  const statusFilter = status?.trim();

  let queryBuilder = admin
    .from("quotes")
    .select(
      "id, slug, status, title, total, created_at, sent_at, expires_at, responded_at, viewed_count, customer:customers(id, full_name), vehicle:vehicles(registration)",
    )
    .eq("location_id", ctx.location.id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (statusFilter && STATUSES.includes(statusFilter as typeof STATUSES[number])) {
    queryBuilder = queryBuilder.eq("status", statusFilter);
  }

  const { data } = await queryBuilder;
  // Supabase types nested relations as arrays in generated types; cast through
  // unknown because the runtime returns a single object for the FK lookups.
  let rows = (data ?? []) as unknown as QuoteRow[];

  if (query) {
    const ql = query.toLowerCase();
    rows = rows.filter((r) => {
      return (
        r.title?.toLowerCase().includes(ql) ||
        r.customer?.full_name?.toLowerCase().includes(ql) ||
        r.vehicle?.registration?.toLowerCase().includes(ql) ||
        r.slug?.toLowerCase().includes(ql)
      );
    });
  }

  const pending = rows.filter((r) => r.status === "pending");
  const approved = rows.filter((r) => r.status === "approved");
  const expired = rows.filter((r) => r.status === "expired");
  const pendingValue = pending.reduce((s, r) => s + Number(r.total ?? 0), 0);
  const approvedValue = approved.reduce((s, r) => s + Number(r.total ?? 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Quotes" description="Prospect + customer quotes sent for review." />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <QuoteFilters initialQ={query} initialStatus={statusFilter ?? ""} />
        <Link href="/staff/quotes/new">
          <Button>
            <Plus className="mr-1 h-4 w-4" /> New quote
          </Button>
        </Link>
      </div>

      {!query && !statusFilter && rows.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Pending ({pending.length})</p>
            <p className="text-2xl font-bold text-amber-600">{fmt(pendingValue)}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Approved ({approved.length})</p>
            <p className="text-2xl font-bold text-green-700">{fmt(approvedValue)}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Expired</p>
            <p className="text-2xl font-bold">{expired.length}</p>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {query || statusFilter ? "No quotes match these filters." : "No quotes yet. Click 'New quote' to send one."}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Title / Reg</th>
                <th className="px-4 py-2 font-medium">Customer</th>
                <th className="px-4 py-2 font-medium text-right">Total</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Sent</th>
                <th className="px-4 py-2 font-medium">Expires</th>
                <th className="px-4 py-2 font-medium text-right">Views</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t hover:bg-muted/20">
                  <td className="px-4 py-2">
                    <Link href={`/staff/quotes/${r.id}`} className="underline">
                      {r.title || `(no title)`}
                    </Link>
                    {r.vehicle?.registration && (
                      <div className="text-xs font-mono text-muted-foreground">{r.vehicle.registration}</div>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {r.customer?.id ? (
                      <Link href={`/staff/customers/${r.customer.id}`} className="underline">
                        {r.customer.full_name ?? "—"}
                      </Link>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmt(Number(r.total ?? 0))}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_STYLE[r.status] ?? ""}`}>
                      {r.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{fmtDate(r.sent_at)}</td>
                  <td className="px-4 py-2 text-muted-foreground">{fmtDate(r.expires_at)}</td>
                  <td className="px-4 py-2 text-right text-muted-foreground tabular-nums">{r.viewed_count ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
