"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireStaffContext } from "@/lib/staff-context";
import { enforceRateLimit, tooManyAttemptsError } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import {
  TICKET_TYPES,
  buildTicketContext,
  createTicket,
  getOrgTicket,
  addStaffReply,
  isTerminalForStaff,
  type TicketType,
} from "@/lib/support-tickets";
import {
  sendNewTicketEmailToPlatform,
  sendStaffReplyEmailToPlatform,
} from "@/lib/support-ticket-emails";

export type TicketActionResult = { error: string } | { ok: true };

export async function createSupportTicketAction(formData: FormData): Promise<TicketActionResult> {
  const ctx = await requireStaffContext();

  const limit = await enforceRateLimit("ticket", ctx.user.id);
  if (!limit.ok) return tooManyAttemptsError(limit.retryAfter);

  const type = String(formData.get("type") ?? "");
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const fromPath = String(formData.get("from_path") ?? "").trim() || null;

  if (!TICKET_TYPES.includes(type as TicketType)) return { error: "Pick a ticket type." };
  if (subject.length < 3 || subject.length > 150) {
    return { error: "Subject must be between 3 and 150 characters." };
  }
  if (body.length < 1 || body.length > 10000) {
    return { error: "Describe the issue (up to 10,000 characters)." };
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

  redirect(`/staff/support/${result.ticket.id}`);
}

export async function replyToTicketAction(
  ticketId: string,
  formData: FormData,
): Promise<TicketActionResult> {
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

  revalidatePath(`/staff/support/${ticket.id}`);
  revalidatePath("/staff/support");
  return { ok: true };
}
