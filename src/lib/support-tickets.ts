// Support tickets + feature requests (tenant staff <-> platform ops).
// Pure status-machine logic up top (unit-tested), service-role data access
// below. Callers authenticate first; every org-side query carries the org id
// so a forged ticket id can never cross tenants (RLS is the backstop).
import { createAdminClient } from "@/lib/supabase/admin";

export const TICKET_TYPES = ["bug", "question", "feature_request"] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export const TICKET_STATUSES = [
  "open",
  "needs_info",
  "in_progress",
  "planned",
  "resolved",
  "closed",
  "declined",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ["p1", "p2", "p3", "p4"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TYPE_LABELS: Record<TicketType, string> = {
  bug: "Bug",
  question: "Question",
  feature_request: "Feature request",
};

export const STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Open",
  needs_info: "Needs info",
  in_progress: "In progress",
  planned: "Planned",
  resolved: "Resolved",
  closed: "Closed",
  declined: "Declined",
};

export const PRIORITY_LABELS: Record<TicketPriority, string> = {
  p1: "P1 · Urgent",
  p2: "P2 · High",
  p3: "P3 · Normal",
  p4: "P4 · Low",
};

export type TicketContext = {
  org_slug?: string | null;
  branch_id?: string | null;
  branch_name?: string | null;
  org_role?: string | null;
  location_role?: string | null;
  path?: string | null;
  user_agent?: string | null;
  app_version?: string | null;
};

export type SupportTicket = {
  id: string;
  organization_id: string;
  location_id: string | null;
  created_by: string | null;
  requester_name: string | null;
  requester_email: string | null;
  type: TicketType;
  status: TicketStatus;
  priority: TicketPriority;
  subject: string;
  context: TicketContext;
  assigned_to: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  last_activity_at: string;
  created_at: string;
};

export type SupportTicketMessage = {
  id: string;
  ticket_id: string;
  organization_id: string;
  author_user_id: string | null;
  author_kind: "staff" | "platform_admin";
  author_name: string | null;
  internal: boolean;
  body: string;
  created_at: string;
};

export type AdminTicketRow = SupportTicket & {
  org: { name: string; slug: string } | null;
};

// ---------------------------------------------------------------------------
// Pure status machine
// ---------------------------------------------------------------------------

// planned / declined belong to the feature-request lifecycle only; bugs and
// questions use the plain support flow.
export function statusesForType(type: TicketType): TicketStatus[] {
  if (type === "feature_request") return [...TICKET_STATUSES];
  return TICKET_STATUSES.filter((s) => s !== "planned" && s !== "declined");
}

export function isValidStatusChange(type: TicketType, from: TicketStatus, to: TicketStatus): boolean {
  return from !== to && statusesForType(type).includes(to);
}

// closed and declined are terminal for staff replies (admins can still reopen
// via the status select); declined gets the same treatment so declined feature
// requests aren't endlessly relitigated in-thread.
export function isTerminalForStaff(status: TicketStatus): boolean {
  return status === "closed" || status === "declined";
}

// A staff reply on resolved/needs_info reopens the conversation (Zendesk
// requester-reply behavior). Anything else leaves the status alone.
export function nextStatusOnStaffReply(status: TicketStatus): TicketStatus | null {
  return status === "resolved" || status === "needs_info" ? "open" : null;
}

// Field updates for a status transition. resolved_at is set on entering
// resolved, PRESERVED on resolved -> closed (keeps the SLA stamp), and cleared
// when leaving resolved anywhere else (a true reopen).
export function statusPatch(
  from: TicketStatus,
  to: TicketStatus,
  nowIso: string,
): { status: TicketStatus; last_activity_at: string; resolved_at?: string | null } {
  const patch: { status: TicketStatus; last_activity_at: string; resolved_at?: string | null } = {
    status: to,
    last_activity_at: nowIso,
  };
  if (to === "resolved") patch.resolved_at = nowIso;
  else if (from === "resolved" && to !== "closed") patch.resolved_at = null;
  return patch;
}

// "#3F2A9C1B" — short human-quotable ref for emails and list columns.
export function shortTicketRef(id: string): string {
  return `#${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

const MAX_UA_LENGTH = 250;

export function buildTicketContext(input: {
  orgSlug?: string | null;
  branchId?: string | null;
  branchName?: string | null;
  orgRole?: string | null;
  locationRole?: string | null;
  path?: string | null;
  userAgent?: string | null;
}): TicketContext {
  return {
    org_slug: input.orgSlug ?? null,
    branch_id: input.branchId ?? null,
    branch_name: input.branchName ?? null,
    org_role: input.orgRole ?? null,
    location_role: input.locationRole ?? null,
    path: input.path ?? null,
    user_agent: input.userAgent ? input.userAgent.slice(0, MAX_UA_LENGTH) : null,
    app_version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
  };
}

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
