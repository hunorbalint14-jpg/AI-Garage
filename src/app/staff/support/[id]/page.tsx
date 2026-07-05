import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { PageHeader } from "@/components/staff/page-header";
import {
  getOrgTicket,
  listStaffVisibleMessages,
  isTerminalForStaff,
  shortTicketRef,
  STATUS_LABELS,
  TYPE_LABELS,
  PRIORITY_LABELS,
  type TicketStatus,
} from "@/lib/support-tickets";
import { ReplyForm } from "./reply-form";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<TicketStatus, string> = {
  open: "bg-amber-100 text-amber-800",
  needs_info: "bg-blue-100 text-blue-800",
  in_progress: "bg-purple-100 text-purple-700",
  planned: "bg-sky-100 text-sky-800",
  resolved: "bg-green-100 text-green-700",
  closed: "bg-gray-200 text-gray-700",
  declined: "bg-red-100 text-red-700",
};

function fmtDateTime(s: string): string {
  return new Date(s).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffContext();
  const { id } = await params;

  const ticket = await getOrgTicket(ctx.organization.id, id);
  if (!ticket) notFound();

  const messages = await listStaffVisibleMessages(ticket.id);
  const terminal = isTerminalForStaff(ticket.status);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <Link href="/staff/support" className="text-xs text-muted-foreground hover:underline">
          ← All tickets
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <PageHeader title={ticket.subject} description={`${TYPE_LABELS[ticket.type]} · ${shortTicketRef(ticket.id)}`} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_STYLE[ticket.status]}`}>
            {STATUS_LABELS[ticket.status]}
          </span>
          <span>{PRIORITY_LABELS[ticket.priority]}</span>
          {ticket.context.branch_name && <span>· {ticket.context.branch_name}</span>}
          <span>· raised {fmtDateTime(ticket.created_at)}</span>
          {ticket.requester_name && <span>· by {ticket.requester_name}</span>}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {messages.map((m) => {
          const fromPlatform = m.author_kind === "platform_admin";
          return (
            <div
              key={m.id}
              className={`rounded-xl border p-4 ${fromPlatform ? "border-primary/30 bg-primary/5" : "bg-card"}`}
            >
              <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {fromPlatform ? "AI Garage Support" : m.author_name ?? "Team member"}
                </span>
                <span>{fmtDateTime(m.created_at)}</span>
              </div>
              <p className="whitespace-pre-wrap text-sm">{m.body}</p>
            </div>
          );
        })}
      </div>

      {terminal ? (
        <div className="rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">
          This ticket is {STATUS_LABELS[ticket.status].toLowerCase()}.{" "}
          <Link href="/staff/support/new" className="underline">
            Raise a new ticket
          </Link>{" "}
          if you need anything else.
        </div>
      ) : (
        <ReplyForm ticketId={ticket.id} showReopenHint={ticket.status === "resolved"} />
      )}
    </div>
  );
}
