import Link from "next/link";
import {
  listAdminTickets,
  shortTicketRef,
  STATUS_LABELS,
  TYPE_LABELS,
  TICKET_STATUSES,
  TICKET_TYPES,
  type TicketStatus,
  type TicketType,
} from "@/lib/support-tickets";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;

// Dark-theme status chips (admin palette, mirrors incidents styling).
const STATUS_CHIP: Record<TicketStatus, string> = {
  open: "border-[#5a4218] bg-[#3a2c14] text-[#ffb020]",
  needs_info: "border-[#2c4458] bg-[#1f2a35] text-[#7ec8ff]",
  in_progress: "border-[#3d2c58] bg-[#2a1f3a] text-[#c39bff]",
  planned: "border-[#2c4458] bg-[#16222c] text-[#7ec8ff]",
  resolved: "border-[#2a5a3a] bg-[#13301f] text-[#5fdd9d]",
  closed: "border-[#2a2f37] bg-[#171b21] text-[#9aa1ad]",
  declined: "border-[#5a2424] bg-[#3a1a1a] text-[#ff7b7b]",
};

function fmtWhen(s: string): string {
  return new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default async function AdminSupportPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string; page?: string }>;
}) {
  const { status, type, page: pageParam } = await searchParams;
  const statusFilter = TICKET_STATUSES.includes((status ?? "") as TicketStatus)
    ? (status as TicketStatus)
    : undefined;
  const typeFilter = TICKET_TYPES.includes((type ?? "") as TicketType)
    ? (type as TicketType)
    : undefined;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  const { rows, totalCount } = await listAdminTickets({
    page,
    pageSize: PAGE_SIZE,
    status: statusFilter,
    type: typeFilter,
  });

  const filterHref = (params: { status?: string; type?: string }) => {
    const parts = [
      params.status ? `status=${params.status}` : "",
      params.type ? `type=${params.type}` : "",
    ].filter(Boolean);
    return `/admin/support${parts.length ? `?${parts.join("&")}` : ""}`;
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-[12.5px] text-[#9aa1ad]">
        Tickets and feature requests raised by garage staff from their portals. Open items await a
        first platform response; needs-info waits on the tenant.
      </p>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <Link
          href={filterHref({ type: typeFilter })}
          className={`rounded-md border px-2.5 py-1 ${!statusFilter ? "border-[#22c55e] text-white" : "border-[#2a2f37] text-[#9aa1ad] hover:text-white"}`}
        >
          All
        </Link>
        {TICKET_STATUSES.map((s) => (
          <Link
            key={s}
            href={filterHref({ status: s, type: typeFilter })}
            className={`rounded-md border px-2.5 py-1 ${statusFilter === s ? "border-[#22c55e] text-white" : "border-[#2a2f37] text-[#9aa1ad] hover:text-white"}`}
          >
            {STATUS_LABELS[s]}
          </Link>
        ))}
        <span className="mx-1 text-[#5a6170]">·</span>
        {TICKET_TYPES.map((t) => (
          <Link
            key={t}
            href={filterHref({ status: statusFilter, type: typeFilter === t ? undefined : t })}
            className={`rounded-md border px-2.5 py-1 ${typeFilter === t ? "border-[#22c55e] text-white" : "border-[#2a2f37] text-[#9aa1ad] hover:text-white"}`}
          >
            {TYPE_LABELS[t]}
          </Link>
        ))}
        <span className="ml-auto text-[#5a6170]">{totalCount} ticket{totalCount !== 1 ? "s" : ""}</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[#23272f] bg-[#171b21]">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead className="bg-[#15181d] text-xs text-[#9aa1ad]">
            <tr>
              <th className="px-3 py-2.5 text-left font-medium">Ref</th>
              <th className="px-3 py-2.5 text-left font-medium">Org</th>
              <th className="px-3 py-2.5 text-left font-medium">Subject</th>
              <th className="px-3 py-2.5 text-left font-medium">Type</th>
              <th className="px-3 py-2.5 text-left font-medium">Status</th>
              <th className="px-3 py-2.5 text-left font-medium">Priority</th>
              <th className="px-3 py-2.5 text-left font-medium">Requester</th>
              <th className="px-3 py-2.5 text-left font-medium">Last activity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-t border-[#23272f] hover:bg-white/[0.02]">
                <td className="px-3 py-2.5 font-mono text-[11px] text-[#9aa1ad]">
                  <Link href={`/admin/support/${t.id}`} className="hover:text-white">
                    {shortTicketRef(t.id)}
                  </Link>
                </td>
                <td className="px-3 py-2.5 text-[#c7ccd4]">{t.org?.name ?? "—"}</td>
                <td className="px-3 py-2.5">
                  <Link href={`/admin/support/${t.id}`} className="font-medium text-white hover:underline">
                    {t.subject}
                  </Link>
                  {!t.first_response_at && t.status === "open" && (
                    <span className="ml-2 rounded-[4px] border border-[#5a2424] bg-[#3a1a1a] px-1.5 py-px font-mono text-[9px] tracking-wide text-[#ff7b7b]">
                      AWAITING FIRST RESPONSE
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-[#9aa1ad]">{TYPE_LABELS[t.type]}</td>
                <td className="px-3 py-2.5">
                  <span className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] ${STATUS_CHIP[t.status]}`}>
                    {STATUS_LABELS[t.status]}
                  </span>
                </td>
                <td className="px-3 py-2.5 font-mono text-[11px] uppercase text-[#9aa1ad]">{t.priority}</td>
                <td className="px-3 py-2.5 text-[#9aa1ad]">{t.requester_name ?? "—"}</td>
                <td className="px-3 py-2.5 text-[#9aa1ad]">{fmtWhen(t.last_activity_at)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-[#5a6170]">
                  No tickets match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-[12px] text-[#9aa1ad]">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={`${filterHref({ status: statusFilter, type: typeFilter })}${statusFilter || typeFilter ? "&" : "?"}page=${page - 1}`} className="rounded-md border border-[#2a2f37] px-2.5 py-1 hover:text-white">
                ← Prev
              </Link>
            )}
            {page < totalPages && (
              <Link href={`${filterHref({ status: statusFilter, type: typeFilter })}${statusFilter || typeFilter ? "&" : "?"}page=${page + 1}`} className="rounded-md border border-[#2a2f37] px-2.5 py-1 hover:text-white">
                Next →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
