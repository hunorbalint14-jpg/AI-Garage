// Support tickets + feature requests (tenant staff <-> platform ops).
// Server-only data access; the pure status machine + types live in
// ./support-tickets-shared (client-safe) and are re-exported here so server
// callers keep a single import path. Every org-side query carries the org id
// so a forged ticket id can never cross tenants (RLS is the backstop).
import { createAdminClient } from "@/lib/supabase/admin";
import {
  nextStatusOnStaffReply,
  statusPatch,
  type SupportTicket,
  type SupportTicketMessage,
  type TicketContext,
  type TicketPriority,
  type TicketStatus,
  type TicketType,
} from "./support-tickets-shared";

export * from "./support-tickets-shared";

export type AdminTicketRow = SupportTicket & {
  org: { name: string; slug: string } | null;
};

// ---------------------------------------------------------------------------
// Data access — service role. Org-side functions take the org id explicitly.
// ---------------------------------------------------------------------------

const TICKET_COLUMNS =
  "id, organization_id, location_id, created_by, requester_name, requester_email, type, status, priority, subject, context, assigned_to, first_response_at, resolved_at, last_activity_at, created_at";

export type CreateTicketInput = {
  organizationId: string;
  locationId: string | null;
  createdBy: string;
  requesterName: string | null;
  requesterEmail: string | null;
  type: TicketType;
  subject: string;
  body: string;
  context: TicketContext;
};

export async function createTicket(
  input: CreateTicketInput,
): Promise<{ ticket: SupportTicket } | { error: string }> {
  const admin = createAdminClient();
  const { data: ticket, error } = await admin
    .from("support_tickets")
    .insert({
      organization_id: input.organizationId,
      location_id: input.locationId,
      created_by: input.createdBy,
      requester_name: input.requesterName,
      requester_email: input.requesterEmail,
      type: input.type,
      subject: input.subject,
      context: input.context,
    })
    .select(TICKET_COLUMNS)
    .single();
  if (error || !ticket) return { error: error?.message ?? "Could not create the ticket." };

  const { error: msgError } = await admin.from("support_ticket_messages").insert({
    ticket_id: ticket.id,
    organization_id: input.organizationId,
    author_user_id: input.createdBy,
    author_kind: "staff",
    author_name: input.requesterName,
    body: input.body,
  });
  if (msgError) {
    // No transactions through supabase-js: compensate so we never leave a
    // subject-only ticket the thread view can't explain.
    await admin.from("support_tickets").delete().eq("id", ticket.id);
    return { error: msgError.message };
  }

  return { ticket: ticket as SupportTicket };
}

export async function listOrgTickets(
  organizationId: string,
  opts: { page: number; pageSize: number; status?: TicketStatus; type?: TicketType },
): Promise<{ rows: SupportTicket[]; totalCount: number }> {
  const admin = createAdminClient();
  let query = admin
    .from("support_tickets")
    .select(TICKET_COLUMNS, { count: "exact" })
    .eq("organization_id", organizationId);
  if (opts.status) query = query.eq("status", opts.status);
  if (opts.type) query = query.eq("type", opts.type);
  const from = (opts.page - 1) * opts.pageSize;
  const { data, count } = await query
    .order("last_activity_at", { ascending: false })
    .range(from, from + opts.pageSize - 1);
  return { rows: (data ?? []) as SupportTicket[], totalCount: count ?? 0 };
}

export async function getOrgTicket(
  organizationId: string,
  ticketId: string,
): Promise<SupportTicket | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("support_tickets")
    .select(TICKET_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", ticketId)
    .maybeSingle();
  return (data as SupportTicket) ?? null;
}

export async function listStaffVisibleMessages(ticketId: string): Promise<SupportTicketMessage[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("support_ticket_messages")
    .select("*")
    .eq("ticket_id", ticketId)
    .eq("internal", false)
    .order("created_at", { ascending: true });
  return (data ?? []) as SupportTicketMessage[];
}

export async function addStaffReply(
  ticket: SupportTicket,
  author: { userId: string; name: string | null },
  body: string,
): Promise<{ message: SupportTicketMessage; newStatus: TicketStatus | null } | { error: string }> {
  const admin = createAdminClient();
  const { data: message, error } = await admin
    .from("support_ticket_messages")
    .insert({
      ticket_id: ticket.id,
      organization_id: ticket.organization_id,
      author_user_id: author.userId,
      author_kind: "staff",
      author_name: author.name,
      body,
    })
    .select("*")
    .single();
  if (error || !message) return { error: error?.message ?? "Could not save the reply." };

  const nowIso = new Date().toISOString();
  const newStatus = nextStatusOnStaffReply(ticket.status);
  const patch = newStatus
    ? statusPatch(ticket.status, newStatus, nowIso)
    : { last_activity_at: nowIso };
  await admin.from("support_tickets").update(patch).eq("id", ticket.id);

  return { message: message as SupportTicketMessage, newStatus };
}

// ---------------------------------------------------------------------------
// Admin data access (platform side)
// ---------------------------------------------------------------------------

export async function listAdminTickets(opts: {
  page: number;
  pageSize: number;
  status?: TicketStatus;
  type?: TicketType;
  organizationId?: string;
}): Promise<{ rows: AdminTicketRow[]; totalCount: number }> {
  const admin = createAdminClient();
  let query = admin
    .from("support_tickets")
    .select(`${TICKET_COLUMNS}, org:organizations(name, slug)`, { count: "exact" });
  if (opts.status) query = query.eq("status", opts.status);
  if (opts.type) query = query.eq("type", opts.type);
  if (opts.organizationId) query = query.eq("organization_id", opts.organizationId);
  const from = (opts.page - 1) * opts.pageSize;
  const { data, count } = await query
    .order("last_activity_at", { ascending: false })
    .range(from, from + opts.pageSize - 1);
  return { rows: (data ?? []) as unknown as AdminTicketRow[], totalCount: count ?? 0 };
}

// Nav badge: tickets awaiting platform action. needs_info waits on the
// tenant, in_progress is already being worked — neither needs the red dot.
export async function countOpenAdminTickets(): Promise<number> {
  const admin = createAdminClient();
  const { count } = await admin
    .from("support_tickets")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");
  return count ?? 0;
}

export async function getAdminTicket(ticketId: string): Promise<AdminTicketRow | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("support_tickets")
    .select(`${TICKET_COLUMNS}, org:organizations(name, slug)`)
    .eq("id", ticketId)
    .maybeSingle();
  return (data as unknown as AdminTicketRow) ?? null;
}

export async function listAllMessages(ticketId: string): Promise<SupportTicketMessage[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("support_ticket_messages")
    .select("*")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });
  return (data ?? []) as SupportTicketMessage[];
}

export async function addAdminMessage(
  ticket: SupportTicket,
  input: { body: string; internal: boolean; authorUserId: string | null; authorName: string | null },
): Promise<{ message: SupportTicketMessage } | { error: string }> {
  const admin = createAdminClient();
  const { data: message, error } = await admin
    .from("support_ticket_messages")
    .insert({
      ticket_id: ticket.id,
      organization_id: ticket.organization_id,
      author_user_id: input.authorUserId,
      author_kind: "platform_admin",
      author_name: input.authorName,
      internal: input.internal,
      body: input.body,
    })
    .select("*")
    .single();
  if (error || !message) return { error: error?.message ?? "Could not save the message." };

  // Internal notes must not leak activity into the staff-facing sort order,
  // and the SLA clock only stops on a PUBLIC reply.
  if (!input.internal) {
    const patch: Record<string, string> = { last_activity_at: new Date().toISOString() };
    if (!ticket.first_response_at) patch.first_response_at = patch.last_activity_at;
    await admin.from("support_tickets").update(patch).eq("id", ticket.id);
  }

  return { message: message as SupportTicketMessage };
}

export async function setTicketStatus(
  ticket: SupportTicket,
  to: TicketStatus,
): Promise<{ ok: true } | { error: string }> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("support_tickets")
    .update(statusPatch(ticket.status, to, new Date().toISOString()))
    .eq("id", ticket.id);
  return error ? { error: error.message } : { ok: true };
}

export async function setTicketPriority(
  ticket: SupportTicket,
  priority: TicketPriority,
): Promise<{ ok: true } | { error: string }> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("support_tickets")
    .update({ priority })
    .eq("id", ticket.id);
  return error ? { error: error.message } : { ok: true };
}
