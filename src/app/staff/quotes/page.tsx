import Link from "next/link";
import { Plus } from "lucide-react";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/staff/page-header";
import { Pagination } from "@/components/staff/pagination";
import { Button } from "@/components/ui/button";
import { QuoteFilters } from "./quote-filters";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const SEARCH_LIMIT = 100;

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

const QUOTE_SELECT =
  "id, quote_type, job_id, slug, status, title, total, created_at, sent_at, expires_at, responded_at, viewed_count, reminder_count, last_reminder_at, customer:customers(id, full_name), vehicle:vehicles(registration), job:jobs(id, customer:customers(id, full_name), vehicle:vehicles(registration))";

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; type?: string; page?: string }>;
}) {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();
  const { q, status, type, page: pageParam } = await searchParams;
  const query = q?.trim() ?? "";
  const statusFilter =
    status && STATUSES.includes(status.trim() as (typeof STATUSES)[number]) ? status.trim() : "";
  const typeFilter =
    type && TYPES.includes(type.trim() as (typeof TYPES)[number]) ? type.trim() : "";
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  // Status/type filters apply to every variant of the quotes query. PostgREST
  // filters compose as URL params, so appending them after order/limit is fine
  // — and dodging a generic helper keeps tsc off the deep-instantiation cliff.
  const filterParams: [string, string][] = [];
  if (statusFilter) filterParams.push(["status", statusFilter]);
  if (typeFilter) filterParams.push(["quote_type", typeFilter]);

  let rows: QuoteRow[];
  let totalCount: number | null = null;

  if (query) {
    // Server-side search — the old version filtered client-side after
    // .limit(200), so anything older than the newest 200 was unfindable.
    // Direct fields (title/slug) match in one query; customer-name and reg
    // matches resolve ids first, then pull quotes that reference them —
    // including DVI quotes, whose customer/vehicle live on the parent job.
    const like = `%${query}%`;
    let directQ = admin
      .from("quotes")
      .select(QUOTE_SELECT)
      .eq("location_id", ctx.location.id)
      .or(`title.ilike.${like},slug.ilike.${like}`);
    for (const [c, v] of filterParams) directQ = directQ.eq(c, v);

    const [directRes, custRes, vehRes] = await Promise.all([
      directQ.order("created_at", { ascending: false }).limit(SEARCH_LIMIT),
      admin
        .from("customers")
        .select("id")
        .eq("organization_id", ctx.organization.id)
        .ilike("full_name", like)
        .limit(50),
      admin
        .from("vehicles")
        .select("id")
        .eq("organization_id", ctx.organization.id)
        .ilike("registration", like)
        .limit(50),
    ]);

    const custIds = (custRes.data ?? []).map((c) => c.id);
    const vehIds = (vehRes.data ?? []).map((v) => v.id);
    const refClauses = [
      custIds.length ? `customer_id.in.(${custIds.join(",")})` : null,
      vehIds.length ? `vehicle_id.in.(${vehIds.join(",")})` : null,
    ].filter(Boolean) as string[];

    let related: QuoteRow[] = [];
    if (refClauses.length > 0) {
      // Standalone quotes reference the customer/vehicle directly.
      let standaloneQ = admin
        .from("quotes")
        .select(QUOTE_SELECT)
        .eq("location_id", ctx.location.id)
        .or(refClauses.join(","));
      for (const [c, v] of filterParams) standaloneQ = standaloneQ.eq(c, v);

      const [standaloneRes, jobsRes] = await Promise.all([
        standaloneQ.order("created_at", { ascending: false }).limit(SEARCH_LIMIT),
        // DVI quotes reference them via their parent job.
        admin
          .from("jobs")
          .select("id")
          .eq("location_id", ctx.location.id)
          .or(refClauses.join(","))
          .limit(SEARCH_LIMIT),
      ]);
      related = (standaloneRes.data ?? []) as unknown as QuoteRow[];

      const jobIds = (jobsRes.data ?? []).map((j) => j.id);
      if (jobIds.length > 0) {
        let jobQuotesQ = admin
          .from("quotes")
          .select(QUOTE_SELECT)
          .eq("location_id", ctx.location.id)
          .in("job_id", jobIds);
        for (const [c, v] of filterParams) jobQuotesQ = jobQuotesQ.eq(c, v);
        const { data: jobQuotes } = await jobQuotesQ
          .order("created_at", { ascending: false })
          .limit(SEARCH_LIMIT);
        related = related.concat((jobQuotes ?? []) as unknown as QuoteRow[]);
      }
    }

    const seen = new Set<string>();
    rows = [...((directRes.data ?? []) as unknown as QuoteRow[]), ...related]
      .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, SEARCH_LIMIT);
  } else {
    // Paginated default list.
    const from = (page - 1) * PAGE_SIZE;
    let listQ = admin
      .from("quotes")
      .select(QUOTE_SELECT, { count: "exact" })
      .eq("location_id", ctx.location.id);
    for (const [c, v] of filterParams) listQ = listQ.eq(c, v);
    const res = await listQ
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    rows = (res.data ?? []) as unknown as QuoteRow[];
    totalCount = res.count;
  }

  // Pipeline stat cards — computed from a dedicated narrow query, so they
  // reflect the whole branch rather than whichever rows this page happens to
  // hold. Only shown on the unfiltered list (as before).
  let stats: { pending: number; approved: number; expired: number; pendingValue: number; approvedValue: number } | null = null;
  if (!query && !statusFilter && !typeFilter && rows.length > 0) {
    const { data: statRows } = await admin
      .from("quotes")
      .select("status, total")
      .eq("location_id", ctx.location.id)
      .in("status", ["pending", "approved", "expired"])
      .limit(2000);
    const s = { pending: 0, approved: 0, expired: 0, pendingValue: 0, approvedValue: 0 };
    for (const r of (statRows ?? []) as { status: string; total: number | null }[]) {
      if (r.status === "pending") {
        s.pending += 1;
        s.pendingValue += Number(r.total ?? 0);
      } else if (r.status === "approved") {
        s.approved += 1;
        s.approvedValue += Number(r.total ?? 0);
      } else {
        s.expired += 1;
      }
    }
    stats = s;
  }

  // Preserve active filters across pagination links.
  const pageParams = new URLSearchParams();
  if (statusFilter) pageParams.set("status", statusFilter);
  if (typeFilter) pageParams.set("type", typeFilter);

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

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Pending ({stats.pending})</p>
            <p className="text-2xl font-bold text-amber-600">{fmt(stats.pendingValue)}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Approved ({stats.approved})</p>
            <p className="text-2xl font-bold text-green-700">{fmt(stats.approvedValue)}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Expired</p>
            <p className="text-2xl font-bold">{stats.expired}</p>
          </div>
        </div>
      )}

      {query && rows.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {rows.length} result{rows.length !== 1 ? "s" : ""} for &ldquo;{query}&rdquo;
          {rows.length >= SEARCH_LIMIT ? " (showing first matches — refine to narrow down)" : ""}
        </p>
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
                    <td className="px-4 py-2 text-muted-foreground">
                      {fmtDate(r.sent_at)}
                      {r.reminder_count > 0 && (
                        <div className="text-[11px]" title={r.last_reminder_at ? `Last reminded ${fmtDate(r.last_reminder_at)}` : undefined}>
                          ↺ {r.reminder_count} reminder{r.reminder_count === 1 ? "" : "s"}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{fmtDate(r.expires_at)}</td>
                    <td className="px-4 py-2 text-right text-muted-foreground tabular-nums">{r.viewed_count ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!query && totalCount !== null && totalCount > PAGE_SIZE && (
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          totalCount={totalCount}
          basePath="/staff/quotes"
          extraParams={pageParams.toString()}
        />
      )}
    </div>
  );
}
