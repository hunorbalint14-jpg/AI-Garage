import Link from "next/link";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { Pagination } from "@/components/staff/pagination";
import {
  WorkshopBadge,
  ChipButton,
  MicroLabel,
  Plate,
  CountdownBadge,
  dueDays,
  type WorkshopTone,
} from "@/components/staff/workshop";
import { QuoteFilters } from "./quote-filters";
import { RemindButton } from "./remind-button";

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
  converted_booking_id: string | null;
  // standalone quotes carry these directly; job quotes derive them via the job.
  customer: PersonRef;
  vehicle: VehicleRef;
  job: { id: string; customer: PersonRef; vehicle: VehicleRef } | null;
};

const STATUS_TONE: Record<string, WorkshopTone> = {
  draft: "neutral",
  pending: "amber",
  approved: "green",
  declined: "red",
  expired: "neutral",
  cancelled: "neutral",
  approved_after_close: "purple",
};

const STATUSES = ["draft", "pending", "approved", "declined", "expired", "cancelled"] as const;
const TYPES = ["job", "standalone"] as const;

function fmt(n: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
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
  "id, quote_type, job_id, slug, status, title, total, created_at, sent_at, expires_at, responded_at, viewed_count, reminder_count, last_reminder_at, converted_booking_id, customer:customers(id, full_name), vehicle:vehicles(registration), job:jobs(id, customer:customers(id, full_name), vehicle:vehicles(registration))";

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

  // Pipeline cells — computed from a dedicated narrow query over the whole
  // branch, ALWAYS visible (filtered, searching, paginated) because the cells
  // ARE the status filter (UX review F11).
  const { data: statRows } = await admin
    .from("quotes")
    .select("status, total, expires_at, converted_booking_id")
    .eq("location_id", ctx.location.id)
    .limit(2000);
  const stats = {
    all: 0,
    draft: 0,
    pending: 0,
    approved: 0,
    expired: 0,
    pendingValue: 0,
    approvedValue: 0,
    expiringSoon: 0, // pending, expires ≤3d
    approvedUnbooked: 0,
  };
  for (const r of (statRows ?? []) as {
    status: string;
    total: number | null;
    expires_at: string | null;
    converted_booking_id: string | null;
  }[]) {
    stats.all += 1;
    if (r.status === "draft") stats.draft += 1;
    else if (r.status === "pending") {
      stats.pending += 1;
      stats.pendingValue += Number(r.total ?? 0);
      const d = dueDays(r.expires_at);
      if (d !== null && d <= 3) stats.expiringSoon += 1;
    } else if (r.status === "approved" || r.status === "approved_after_close") {
      stats.approved += 1;
      stats.approvedValue += Number(r.total ?? 0);
      if (!r.converted_booking_id) stats.approvedUnbooked += 1;
    } else if (r.status === "expired") stats.expired += 1;
  }

  // Preserve active filters across pagination links.
  const pageParams = new URLSearchParams();
  if (statusFilter) pageParams.set("status", statusFilter);
  if (typeFilter) pageParams.set("type", typeFilter);

  // Pipeline cell definitions — each cell is a status-filter link (F11).
  const cellHref = (s: string) => {
    const sp2 = new URLSearchParams();
    if (s) sp2.set("status", s);
    if (typeFilter) sp2.set("type", typeFilter);
    if (query) sp2.set("q", query);
    const qs = sp2.toString();
    return qs ? `/staff/quotes?${qs}` : "/staff/quotes";
  };
  const CELL_TONE: Record<string, { text: string; bg: string; bar: string }> = {
    "": { text: "text-ws-text", bg: "bg-ws-hover", bar: "#e6e8eb" },
    draft: { text: "text-ws-text-2", bg: "bg-ws-hover", bar: "#9aa1ad" },
    pending: { text: "text-ws-amber", bg: "bg-ws-amber-bg", bar: "#ffb020" },
    approved: { text: "text-ws-green", bg: "bg-ws-green-bg", bar: "#5fdd9d" },
    expired: { text: "text-ws-text-2", bg: "bg-ws-hover", bar: "#9aa1ad" },
  };
  const cells: { status: string; label: string; value: string; sub?: { text: string; cls: string } }[] = [
    { status: "", label: "All", value: String(stats.all) },
    { status: "draft", label: "Draft", value: String(stats.draft) },
    {
      status: "pending",
      label: "Pending",
      value: `${stats.pending} → ${fmt(stats.pendingValue)}`,
      sub: stats.expiringSoon > 0 ? { text: `${stats.expiringSoon} expire ≤3d`, cls: "text-ws-red" } : undefined,
    },
    {
      status: "approved",
      label: "Approved",
      value: `${stats.approved} → ${fmt(stats.approvedValue)}`,
      sub: stats.approvedUnbooked > 0 ? { text: `${stats.approvedUnbooked} not yet booked`, cls: "text-ws-text-3" } : undefined,
    },
    { status: "expired", label: "Expired", value: String(stats.expired) },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Header states the job to be done (§1f). One amber primary. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <MicroLabel>Quotes · {ctx.organization.name}</MicroLabel>
          <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.01em] text-ws-text">
            {stats.pending > 0
              ? `${fmt(stats.pendingValue)} waiting on customers`
              : "Quotes"}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <QuoteFilters initialQ={query} initialType={typeFilter ?? ""} />
          <ChipButton variant="primary" href="/staff/quotes/new">
            + New quote
          </ChipButton>
        </div>
      </div>

      {/* Pipeline row = the status filter. Always visible. */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[6px] border border-ws-border bg-ws-border sm:grid-cols-5">
        {cells.map((c) => {
          const active = (statusFilter || "") === c.status;
          const tone = CELL_TONE[c.status];
          return (
            <Link
              key={c.status || "all"}
              href={cellHref(c.status)}
              aria-current={active ? "page" : undefined}
              className={`flex flex-col gap-1 px-3.5 py-3 no-underline transition-colors ${
                active ? tone.bg : "bg-ws-card hover:bg-ws-hover"
              }`}
              style={active ? { boxShadow: `inset 0 -2px 0 ${tone.bar}` } : undefined}
            >
              <span className={`font-mono text-[9px] font-semibold uppercase tracking-[0.12em] ${active ? tone.text : "text-ws-text-3"}`}>
                {c.label}
              </span>
              <span className={`font-mono text-[18px] font-semibold leading-none ${active ? tone.text : "text-ws-text"}`}>
                {c.value}
              </span>
              {c.sub && <span className={`font-mono text-[9px] ${c.sub.cls}`}>{c.sub.text}</span>}
            </Link>
          );
        })}
      </div>

      {query && rows.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {rows.length} result{rows.length !== 1 ? "s" : ""} for &ldquo;{query}&rdquo;
          {rows.length >= SEARCH_LIMIT ? " (showing first matches — refine to narrow down)" : ""}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-ws-border p-8 text-center">
          <p className="font-mono text-xs text-ws-text-3">
            {query || statusFilter || typeFilter ? "// NO QUOTES MATCH THESE FILTERS" : "// NO QUOTES YET"}
          </p>
          {!query && !statusFilter && !typeFilter && (
            <p className="mt-2 text-sm text-muted-foreground">Send your first with &lsquo;+ New quote&rsquo;.</p>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-ws-border overflow-x-auto">
          {/* 8 columns → 6 (§1f): type + reg fold into QUOTE, sent/views
              compress into the EXPIRES activity sub-line, ACTION chases money. */}
          <table className="w-full text-sm">
            <thead className="text-left">
              <tr className="border-b border-ws-border">
                {["Quote", "Customer", "Total", "Status", "Expires", "Action"].map((h, i) => (
                  <th
                    key={h}
                    className={`px-4 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ws-text-3 ${
                      i === 2 || i === 5 ? "text-right" : ""
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const cust = customerOf(r);
                const veh = vehicleOf(r);
                const isJob = r.quote_type === "job";
                const isPending = r.status === "pending";
                const isApprovedUnbooked =
                  (r.status === "approved" || r.status === "approved_after_close") && !r.converted_booking_id;
                return (
                  <tr key={r.id} className="border-t border-ws-border hover:bg-ws-hover/50">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Link href={`/staff/quotes/${r.id}`} className="text-[13px] font-semibold text-ws-text no-underline hover:underline">
                          {r.title || "(no title)"}
                        </Link>
                        {isJob && <WorkshopBadge tone="purple">DVI</WorkshopBadge>}
                      </div>
                      {veh?.registration && <Plate reg={veh.registration} className="mt-1" />}
                    </td>
                    <td className="px-4 py-2.5">
                      {cust?.id ? (
                        <Link href={`/staff/customers/${cust.id}`} className="text-ws-text no-underline hover:underline">
                          {cust.full_name ?? "—"}
                        </Link>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-[13px] font-semibold tabular-nums text-ws-text">
                      £{Math.round(Number(r.total ?? 0)).toLocaleString("en-GB")}
                    </td>
                    <td className="px-4 py-2.5">
                      <WorkshopBadge tone={STATUS_TONE[r.status] ?? "neutral"}>
                        {r.status.replace(/_/g, " ")}
                      </WorkshopBadge>
                    </td>
                    <td className="px-4 py-2.5">
                      <CountdownBadge expiresAt={isPending ? r.expires_at : null} />
                      <div className="mt-1 font-mono text-[9px] text-ws-text-3">
                        {r.viewed_count > 0 ? `viewed ${r.viewed_count}×` : r.sent_at ? "never viewed" : "not sent"}
                        {r.reminder_count > 0 ? ` · ↺${r.reminder_count}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {isPending ? (
                        <RemindButton quoteId={r.id} />
                      ) : isApprovedUnbooked ? (
                        <Link
                          href={`/staff/quotes/${r.id}`}
                          className="inline-block rounded-[2px] border border-ws-green-border bg-ws-green-bg px-2 py-[3px] font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-ws-green no-underline transition-colors hover:bg-[#1a4029]"
                        >
                          Book job →
                        </Link>
                      ) : (
                        <Link
                          href={`/staff/quotes/${r.id}`}
                          className="border-b border-[#3a4049] font-mono text-[10px] font-medium text-ws-text-2 no-underline transition-colors hover:text-ws-text"
                        >
                          view →
                        </Link>
                      )}
                    </td>
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
