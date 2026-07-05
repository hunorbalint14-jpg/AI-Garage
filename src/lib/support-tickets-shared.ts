// Pure half of the support-ticket lib: constants, types and the status
// machine. Safe for client components (no supabase/admin import) — the
// server-only data access lives in ./support-tickets, which re-exports
// everything here so server code keeps a single import path.

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
  /** Object path in the private support-shots bucket (widget screenshot). */
  screenshot_path?: string | null;
  /** Sentry.lastEventId() at raise time, when the client SDK has one. */
  sentry_event_id?: string | null;
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
  screenshotPath?: string | null;
  sentryEventId?: string | null;
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
    screenshot_path: input.screenshotPath ?? null,
    sentry_event_id: input.sentryEventId ? input.sentryEventId.slice(0, 64) : null,
  };
}
