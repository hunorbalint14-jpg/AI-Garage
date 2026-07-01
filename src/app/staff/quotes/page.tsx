import Link from "next/link";
import { Plus } from "lucide-react";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/staff/page-header";
import { Button } from "@/components/ui/button";
import { QuoteFilters } from "./quote-filters";

export const dynamic = "force-dynamic";

type PersonRef = { id: string; full_name: string | null } | null;
type VehicleRef = { registration: string | null } | null;

type QuoteRow = {
  id: string;
  quote_type: "job" | "standalone";
  job_id: string | null;
  slug: string | null;
  status: string;
  title: string | null;
  total: number;
  created_at: string;
  sent_at: string | null;
  expires_at: string | null;
  responded_at: string | null;
  viewed_count: number;
  reminder_count: number;
  last_reminder_at: string | null;
  // standalone quotes carry these directly; job quotes derive them via the job.
  customer: PersonRef;
  vehicle: VehicleRef;
  job: { id: string; customer: PersonRef; vehicle: VehicleRef } | null;
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
const TYPES = ["job", "standalone"] as const;

function fmt(n: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// A job quote's customer/vehicle live on its parent job; standalone quotes
// carry them directly.
function customerOf(r: QuoteRow): PersonRef {
  return r.quote_type === "job" ? r.job?.customer ?? null : r.customer;
}
function vehicleOf(r: QuoteRow): VehicleRef {
  return r.quote_type === "job" ? r.job?.vehicle ?? null : r.vehicle;
}

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; type?: string }>;
}) {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();
  const { q, status, type } = await searchParams;
  const query = q?.trim() ?? "";
  const statusFilter = status?.trim();
  const typeFilter = type?.trim();

  let queryBuilder = admin
    .from("quotes")
    .select(
      "id, quote_type, job_id, slug, status, title, total, created_at, sent_at, expires_at, responded_at, viewed_count, reminder_count, last_reminder_at, customer:customers(id, full_name), vehicle:vehicles(registration), job:jobs(id, customer:customers(id, full_name), vehicle:vehicles(registration))",
    )
    .eq("location_id", ctx.location.id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (statusFilter && STATUSES.includes(statusFilter as typeof STATUSES[number])) {
    queryBuilder = queryBuilder.eq("status", statusFilter);
  }
  if (typeFilter && TYPES.includes(typeFilter as typeof TYPES[number])) {
    queryBuilder = queryBuilder.eq("quote_type", typeFilter);
  }

  const { data } = await queryBuilder;
  // Supabase types nested relations as arrays; cast through unknown because the
  // runtime returns a single object for these to-one lookups.
  let rows = (data ?? []) as unknown as QuoteRow[];

  if (query) {
    const ql = query.toLowerCase();
    rows = rows.filter((r) => {
      const cust = customerOf(r)?.full_name?.toLowerCase();
      const reg = vehicleOf(r)?.registration?.toLowerCase();
      return (
        r.title?.toLowerCase().includes(ql) ||
        cust?.includes(ql) ||
        reg?.includes(ql) ||
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
      <PageHeader title="Quotes" description="Every quote — pre-job and in-job (DVI) — in one place." />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <QuoteFilters initialQ={query} initialStatus={statusFilter ?? ""} initialType={typeFilter ?? ""} />
        <Link href="/staff/quotes/new">
          <Button>
            <Plus className="mr-1 h-4 w-4" /> New quote
          </Button>
        </Link>
      </div>

      {!query && !statusFilter && !typeFilter && rows.length > 0 && (
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
            {query || statusFilter || typeFilter ? "No quotes match these filters." : "No quotes yet. Click 'New quote' to send one."}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Type</th>
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
              {rows.map((r) => {
                const cust = customerOf(r);
                const veh = vehicleOf(r);
                const isJob = r.quote_type === "job";
                return (
                  <tr key={r.id} className="border-t hover:bg-muted/20">
                    <td className="px-4 py-2">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                          isJob ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
                        }`}
                      >
                        {isJob ? "DVI" : "Pre-job"}
                      </span>
                      {isJob && r.job_id && (
                        <Link href={`/staff/jobs/${r.job_id}`} className="mt-1 block text-[11px] text-muted-foreground underline">
                          View job →
                        </Link>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <Link href={`/staff/quotes/${r.id}`} className="underline">
                        {r.title || `(no title)`}
                      </Link>
                      {veh?.registration && (
                        <div className="text-xs font-mono text-muted-foreground">{veh.registration}</div>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {cust?.id ? (
                        <Link href={`/staff/customers/${cust.id}`} className="underline">
                          {cust.full_name ?? "—"}
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
