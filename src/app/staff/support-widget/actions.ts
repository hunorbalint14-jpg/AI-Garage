"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { requireStaffContext } from "@/lib/staff-context";
import { enforceRateLimit, tooManyAttemptsError } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  TICKET_TYPES,
  buildTicketContext,
  createTicket,
  getOrgTicket,
  addStaffReply,
  isTerminalForStaff,
  listOrgTickets,
  listStaffVisibleMessages,
  shortTicketRef,
  type SupportTicket,
  type SupportTicketMessage,
  type TicketType,
} from "@/lib/support-tickets";
import { createShotUploadUrl, shotObjectExists, shotPath } from "@/lib/support-shots";
import { TICKET_NOTIFICATION_KINDS } from "@/lib/staff-notifications";
import {
  sendNewTicketEmailToPlatform,
  sendStaffReplyEmailToPlatform,
} from "@/lib/support-ticket-emails";

// Server actions for the floating support widget (moved from the retired
// /staff/support pages). All in-panel: no redirects, no revalidates — the
// widget owns its state client-side.

export type CreateTicketResult =
  | { ok: true; ticketId: string; ref: string }
  | { error: string };

export async function createSupportTicketAction(formData: FormData): Promise<CreateTicketResult> {
  const ctx = await requireStaffContext();

  const limit = await enforceRateLimit("ticket", ctx.user.id);
  if (!limit.ok) return tooManyAttemptsError(limit.retryAfter);

  const type = String(formData.get("type") ?? "");
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const fromPath = String(formData.get("from_path") ?? "").trim() || null;
  const sentryEventId = String(formData.get("sentry_event_id") ?? "").trim() || null;
  const screenshotPathRaw = String(formData.get("screenshot_path") ?? "").trim() || null;

  if (!TICKET_TYPES.includes(type as TicketType)) return { error: "Pick a ticket type." };
  if (subject.length < 3 || subject.length > 150) {
    return { error: "Subject must be between 3 and 150 characters." };
  }
  if (body.length < 1 || body.length > 10000) {
    return { error: "Describe the issue (up to 10,000 characters)." };
  }

  // A screenshot path is only trusted when it sits under THIS org's folder
  // and the object really exists — anything else is dropped silently (the
  // ticket must still send when the upload failed or was forged).
  let screenshotPath: string | null = null;
  if (screenshotPathRaw) {
    const pattern = new RegExp(`^${ctx.organization.id}/[0-9a-f-]{36}\\.png$`);
    if (pattern.test(screenshotPathRaw) && (await shotObjectExists(screenshotPathRaw))) {
      screenshotPath = screenshotPathRaw;
    }
  }

  const h = await headers();
  const context = buildTicketContext({
    orgSlug: ctx.organization.slug,
    branchId: ctx.location.id,
    branchName: ctx.location.name,
    orgRole: ctx.orgRole,
    locationRole: ctx.locationRole,
    path: fromPath,
    userAgent: h.get("user-agent"),
    screenshotPath,
    sentryEventId,
  });

  const result = await createTicket({
    organizationId: ctx.organization.id,
    locationId: ctx.location.id,
    createdBy: ctx.user.id,
    requesterName: ctx.user.fullName,
    requesterEmail: ctx.user.email ?? null,
    type: type as TicketType,
    subject,
    body,
    context,
  });
  if ("error" in result) return { error: result.error };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "ticket.create",
    entityType: "support_ticket",
    entityId: result.ticket.id,
    metadata: { type, subject },
  });

  const orgName = ctx.organization.name;
  after(() => sendNewTicketEmailToPlatform(result.ticket, orgName, body));

  return { ok: true, ticketId: result.ticket.id, ref: shortTicketRef(result.ticket.id) };
}

export type ReplyResult = { ok: true } | { error: string };

export async function replyToTicketAction(
  ticketId: string,
  formData: FormData,
): Promise<ReplyResult> {
  const ctx = await requireStaffContext();

  const ticket = await getOrgTicket(ctx.organization.id, ticketId);
  if (!ticket) return { error: "Ticket not found." };
  if (isTerminalForStaff(ticket.status)) {
    return { error: "This ticket is closed — raise a new one if you need more help." };
  }

  const limit = await enforceRateLimit("ticketReply", ctx.user.id);
  if (!limit.ok) return tooManyAttemptsError(limit.retryAfter);

  const body = String(formData.get("body") ?? "").trim();
  if (body.length < 1 || body.length > 10000) {
    return { error: "Write a reply (up to 10,000 characters)." };
  }

  const result = await addStaffReply(ticket, { userId: ctx.user.id, name: ctx.user.fullName }, body);
  if ("error" in result) return { error: result.error };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "ticket.reply",
    entityType: "support_ticket",
    entityId: ticket.id,
  });

  const orgName = ctx.organization.name;
  after(() => sendStaffReplyEmailToPlatform(ticket, orgName, body));

  return { ok: true };
}

export type MyTicketsResult = {
  rows: SupportTicket[];
  unreadTicketIds: string[];
};

export async function listMyTicketsAction(): Promise<MyTicketsResult> {
  const ctx = await requireStaffContext();
  const { rows } = await listOrgTickets(ctx.organization.id, { page: 1, pageSize: 20 });

  // Unread ticket ids for the "1 NEW" pills — the caller's own targeted
  // notifications only.
  const admin = createAdminClient();
  const { data } = await admin
    .from("staff_notifications")
    .select("entity_id")
    .eq("user_id", ctx.user.id)
    .in("kind", [...TICKET_NOTIFICATION_KINDS])
    .is("read_at", null)
    .not("entity_id", "is", null);
  const unreadTicketIds = [...new Set((data ?? []).map((r) => r.entity_id as string))];

  return { rows, unreadTicketIds };
}

export type ThreadResult =
  | { ticket: SupportTicket; messages: SupportTicketMessage[] }
  | { error: string };

export async function getThreadAction(ticketId: string): Promise<ThreadResult> {
  const ctx = await requireStaffContext();
  const ticket = await getOrgTicket(ctx.organization.id, ticketId);
  if (!ticket) return { error: "Ticket not found." };
  const messages = await listStaffVisibleMessages(ticket.id);
  return { ticket, messages };
}

// Clears the caller's own unread ticket.* notifications for one ticket and
// returns how many were cleared so the client can decrement its badge. The
// user_id scoping makes a forged ticket id harmless — you can only clear
// your own notifications.
export async function markTicketNotificationsReadAction(
  ticketId: string,
): Promise<{ cleared: number }> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();
  const { data } = await admin
    .from("staff_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", ctx.user.id)
    .eq("entity_type", "support_ticket")
    .eq("entity_id", ticketId)
    .is("read_at", null)
    .select("id");
  return { cleared: data?.length ?? 0 };
}

export type ShotUploadUrlResult = { url: string; token: string; path: string } | { error: string };

export async function createShotUploadUrlAction(): Promise<ShotUploadUrlResult> {
  const ctx = await requireStaffContext();
  const path = shotPath(ctx.organization.id);
  const minted = await createShotUploadUrl(path);
  if ("error" in minted) return minted;
  return { ...minted, path };
}
