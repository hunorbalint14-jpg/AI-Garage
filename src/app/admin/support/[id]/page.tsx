import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getAdminTicket,
  listAllMessages,
  shortTicketRef,
  STATUS_LABELS,
  TYPE_LABELS,
  PRIORITY_LABELS,
} from "@/lib/support-tickets";
import { TicketControls } from "./ticket-controls";

export const dynamic = "force-dynamic";

function fmtWhen(s: string): string {
  return new Date(s).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function AdminTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ticket = await getAdminTicket(id);
  if (!ticket) notFound();

  const messages = await listAllMessages(ticket.id);

  const contextRows: { label: string; value: string | null }[] = [
    { label: "Organisation", value: ticket.org?.name ?? null },
    { label: "Branch", value: ticket.context.branch_name ?? null },
    {
      label: "Requester",
      value: ticket.requester_name
        ? `${ticket.requester_name}${ticket.requester_email ? ` · ${ticket.requester_email}` : ""}`
        : ticket.requester_email,
    },
    { label: "Role", value: ticket.context.org_role ?? ticket.context.location_role ?? null },
    { label: "Page", value: ticket.context.path ?? null },
    { label: "User agent", value: ticket.context.user_agent ?? null },
    { label: "App version", value: ticket.context.app_version ?? null },
    { label: "Raised", value: fmtWhen(ticket.created_at) },
    { label: "First response", value: ticket.first_response_at ? fmtWhen(ticket.first_response_at) : "— awaiting" },
    { label: "Resolved", value: ticket.resolved_at ? fmtWhen(ticket.resolved_at) : null },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/admin/support" className="text-[12px] text-[#9aa1ad] hover:text-white">
          ← Support queue
        </Link>
        <h2 className="mt-1 text-[17px] font-semibold text-white">
          {ticket.subject}{" "}
          <span className="font-mono text-[12px] font-normal text-[#5a6170]">
            {shortTicketRef(ticket.id)} · {TYPE_LABELS[ticket.type]} · {STATUS_LABELS[ticket.status]} ·{" "}
            {PRIORITY_LABELS[ticket.priority]}
          </span>
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
        {/* Thread + controls */}
        <div className="flex flex-col gap-3">
          {messages.map((m) => {
            const fromPlatform = m.author_kind === "platform_admin";
            return (
              <div
                key={m.id}
                className={`rounded-xl border p-3.5 ${
                  m.internal
                    ? "border-[#5a4218] bg-[#241c0d]"
                    : fromPlatform
                      ? "border-[#2a5a3a] bg-[#101c15]"
                      : "border-[#23272f] bg-[#171b21]"
                }`}
              >
                <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-[#9aa1ad]">
                  <span className="font-medium text-[#c7ccd4]">
                    {fromPlatform ? (m.author_name ?? "Platform admin") : (m.author_name ?? "Staff")}
                    {m.internal && (
                      <span className="ml-2 rounded-[4px] border border-[#5a4218] bg-[#3a2c14] px-1.5 py-px font-mono text-[9px] tracking-wide text-[#ffb020]">
                        INTERNAL
                      </span>
                    )}
                  </span>
                  <span>{fmtWhen(m.created_at)}</span>
                </div>
                <p className="whitespace-pre-wrap text-[13px] text-[#e6e8eb]">{m.body}</p>
              </div>
            );
          })}

          <TicketControls
            ticketId={ticket.id}
            ticketType={ticket.type}
            currentStatus={ticket.status}
            currentPriority={ticket.priority}
          />
        </div>

        {/* Context panel */}
        <aside className="h-fit rounded-xl border border-[#23272f] bg-[#171b21] p-4">
          <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-[#9aa1ad]">
            Context
          </h3>
          <dl className="flex flex-col gap-2.5">
            {contextRows
              .filter((r) => r.value)
              .map((r) => (
                <div key={r.label}>
                  <dt className="font-mono text-[10px] uppercase tracking-wide text-[#5a6170]">{r.label}</dt>
                  <dd className="mt-0.5 break-words text-[12.5px] text-[#c7ccd4]">
                    {r.label === "Organisation" && ticket.organization_id ? (
                      <Link href={`/admin/orgs/${ticket.organization_id}`} className="text-[#7ec8ff] hover:underline">
                        {r.value}
                      </Link>
                    ) : (
                      r.value
                    )}
                  </dd>
                </div>
              ))}
          </dl>
        </aside>
      </div>
    </div>
  );
}
