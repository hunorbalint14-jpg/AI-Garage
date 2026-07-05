import Link from "next/link";
import { requireStaffContext } from "@/lib/staff-context";
import { PageHeader } from "@/components/staff/page-header";
import { Pagination } from "@/components/staff/pagination";
import {
  listOrgTickets,
  shortTicketRef,
  STATUS_LABELS,
  TYPE_LABELS,
  TICKET_STATUSES,
  TICKET_TYPES,
  type TicketStatus,
  type TicketType,
} from "@/lib/support-tickets";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

const STATUS_STYLE: Record<TicketStatus, string> = {
  open: "bg-amber-100 text-amber-800",
  needs_info: "bg-blue-100 text-blue-800",
  in_progress: "bg-purple-100 text-purple-700",
  planned: "bg-sky-100 text-sky-800",
  resolved: "bg-green-100 text-green-700",
  closed: "bg-gray-200 text-gray-700",
  declined: "bg-red-100 text-red-700",
};

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string; page?: string }>;
}) {
  const ctx = await requireStaffContext();
  const { status, type, page: pageParam } = await searchParams;

  const statusFilter = TICKET_STATUSES.includes((status ?? "") as TicketStatus)
    ? (status as TicketStatus)
    : undefined;
  const typeFilter = TICKET_TYPES.includes((type ?? "") as TicketType)
    ? (type as TicketType)
    : undefined;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  const { rows, totalCount } = await listOrgTickets(ctx.organization.id, {
    page,
    pageSize: PAGE_SIZE,
    status: statusFilter,
    type: typeFilter,
  });

  const extraParams = [
    statusFilter ? `status=${statusFilter}` : "",
    typeFilter ? `type=${typeFilter}` : "",
  ]
    .filter(Boolean)
    .join("&");

  const filterHref = (params: { status?: string; type?: string }) => {
    const parts = [
      params.status ? `status=${params.status}` : "",
      params.type ? `type=${params.type}` : "",
    ].filter(Boolean);
    return `/staff/support${parts.length ? `?${parts.join("&")}` : ""}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Support"
          description="Raise bugs, questions and feature requests with the AI Garage team."
        />
        <Link
          href="/staff/support/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          New ticket
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link
          href={filterHref({ type: typeFilter })}
          className={`rounded-full border px-3 py-1 ${!statusFilter ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground hover:bg-muted"}`}
        >
          All statuses
        </Link>
        {TICKET_STATUSES.map((s) => (
          <Link
            key={s}
            href={filterHref({ status: s, type: typeFilter })}
            className={`rounded-full border px-3 py-1 ${statusFilter === s ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground hover:bg-muted"}`}
          >
            {STATUS_LABELS[s]}
          </Link>
        ))}
        <span className="mx-1 text-muted-foreground/40">·</span>
        {TICKET_TYPES.map((t) => (
          <Link
            key={t}
            href={filterHref({ status: statusFilter, type: typeFilter === t ? undefined : t })}
            className={`rounded-full border px-3 py-1 ${typeFilter === t ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground hover:bg-muted"}`}
          >
            {TYPE_LABELS[t]}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border bg-card p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No tickets yet. Found a bug or want a feature? We read every one.
          </p>
          <Link
            href="/staff/support/new"
            className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Raise your first ticket
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Ref</th>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Raised by</th>
                <th className="px-4 py-3">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {shortTicketRef(t.id)}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/staff/support/${t.id}`} className="font-medium hover:underline">
                      {t.subject}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{TYPE_LABELS[t.type]}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[t.status]}`}>
                      {STATUS_LABELS[t.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{t.requester_name ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{fmtDate(t.last_activity_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={totalCount}
        basePath="/staff/support"
        extraParams={extraParams}
      />
    </div>
  );
}
