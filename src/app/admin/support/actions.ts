"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { logAudit } from "@/lib/audit";
import { createStaffNotification } from "@/lib/staff-notifications";
import {
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  STATUS_LABELS,
  getAdminTicket,
  addAdminMessage,
  setTicketStatus,
  setTicketPriority,
  isValidStatusChange,
  shortTicketRef,
  type TicketPriority,
  type TicketStatus,
} from "@/lib/support-tickets";
import {
  sendAdminReplyEmailToRequester,
  sendStatusChangeEmailToRequester,
} from "@/lib/support-ticket-emails";

export type AdminTicketActionResult = { error: string } | { ok: true };

function revalidateTicket(ticketId: string) {
  revalidatePath("/admin/support");
  revalidatePath(`/admin/support/${ticketId}`);
}

// In-app bell ping for the requester. Skipped when the raise-time branch was
// deleted (staff_notifications.location_id is NOT NULL) or the requesting
// user no longer exists — the snapshot email still goes in both cases.
async function notifyRequester(
  ticket: { id: string; location_id: string | null; organization_id: string; created_by: string | null },
  kind: "ticket.reply" | "ticket.status",
  title: string,
) {
  if (!ticket.location_id || !ticket.created_by) return;
  await createStaffNotification({
    userId: ticket.created_by,
    locationId: ticket.location_id,
    organizationId: ticket.organization_id,
    kind,
    title,
    href: `/staff?ticket=${ticket.id}`,
    entityType: "support_ticket",
    entityId: ticket.id,
  });
}

// Reply (public or internal note), optionally setting a status in the same
// submit — Zendesk-style "reply and set status". One combined requester email
// when both happen.
export async function adminReplyAction(
  ticketId: string,
  formData: FormData,
): Promise<AdminTicketActionResult> {
  const actor = await requirePlatformAdmin();

  const ticket = await getAdminTicket(ticketId);
  if (!ticket) return { error: "Ticket not found." };

  const body = String(formData.get("body") ?? "").trim();
  const internal = formData.get("internal") === "on";
  const statusRaw = String(formData.get("status") ?? "");
  const wantsStatus =
    statusRaw !== "" && statusRaw !== ticket.status
      ? (statusRaw as TicketStatus)
      : null;

  if (body.length < 1 || body.length > 10000) {
    return { error: "Write a message (up to 10,000 characters)." };
  }
  if (wantsStatus) {
    if (!TICKET_STATUSES.includes(wantsStatus)) return { error: "Unknown status." };
    if (!isValidStatusChange(ticket.type, ticket.status, wantsStatus)) {
      return { error: `Cannot move a ${ticket.type.replace("_", " ")} to ${STATUS_LABELS[wantsStatus]}.` };
    }
    if (internal) return { error: "Internal notes cannot change the status — reply publicly or use the status control." };
  }

  const result = await addAdminMessage(ticket, {
    body,
    internal,
    authorUserId: actor.id,
    authorName: actor.email ?? null,
  });
  if ("error" in result) return { error: result.error };

  if (wantsStatus) {
    const statusResult = await setTicketStatus(ticket, wantsStatus);
    if ("error" in statusResult) return { error: statusResult.error };
  }

  await logAudit({
    // Internal notes never surface in the tenant's audit log.
    organizationId: internal ? null : ticket.organization_id,
    actorUserId: actor.id,
    actorEmail: actor.email ?? null,
    action: internal ? "ticket.internal_note" : "ticket.reply",
    entityType: "support_ticket",
    entityId: ticket.id,
    metadata: wantsStatus ? { status: wantsStatus } : undefined,
  });

  if (!internal) {
    const orgSlug = ticket.org?.slug ?? "";
    const actingEmail = actor.email ?? null;
    after(async () => {
      await sendAdminReplyEmailToRequester(ticket, orgSlug, body, {
        actingAdminEmail: actingEmail,
        newStatus: wantsStatus,
      });
      await notifyRequester(
        ticket,
        "ticket.reply",
        `Support replied on ${shortTicketRef(ticket.id)}`,
      );
    });
  }

  revalidateTicket(ticket.id);
  return { ok: true };
}

export async function adminSetStatusAction(
  ticketId: string,
  status: string,
): Promise<AdminTicketActionResult> {
  const actor = await requirePlatformAdmin();

  const ticket = await getAdminTicket(ticketId);
  if (!ticket) return { error: "Ticket not found." };
  const to = status as TicketStatus;
  if (!TICKET_STATUSES.includes(to)) return { error: "Unknown status." };
  if (!isValidStatusChange(ticket.type, ticket.status, to)) {
    return { error: `Cannot move a ${ticket.type.replace("_", " ")} to ${STATUS_LABELS[to]}.` };
  }

  const result = await setTicketStatus(ticket, to);
  if ("error" in result) return { error: result.error };

  await logAudit({
    organizationId: ticket.organization_id,
    actorUserId: actor.id,
    actorEmail: actor.email ?? null,
    action: "ticket.status_change",
    entityType: "support_ticket",
    entityId: ticket.id,
    metadata: { from: ticket.status, to },
  });

  const orgSlug = ticket.org?.slug ?? "";
  const actingEmail = actor.email ?? null;
  after(async () => {
    await sendStatusChangeEmailToRequester(ticket, orgSlug, to, { actingAdminEmail: actingEmail });
    await notifyRequester(
      ticket,
      "ticket.status",
      `Ticket ${shortTicketRef(ticket.id)} is now ${STATUS_LABELS[to]}`,
    );
  });

  revalidateTicket(ticket.id);
  return { ok: true };
}

export async function adminSetPriorityAction(
  ticketId: string,
  priority: string,
): Promise<AdminTicketActionResult> {
  const actor = await requirePlatformAdmin();

  const ticket = await getAdminTicket(ticketId);
  if (!ticket) return { error: "Ticket not found." };
  const p = priority as TicketPriority;
  if (!TICKET_PRIORITIES.includes(p)) return { error: "Unknown priority." };
  if (p === ticket.priority) return { ok: true };

  const result = await setTicketPriority(ticket, p);
  if ("error" in result) return { error: result.error };

  // Priority is internal triage — audited, but nobody is emailed or pinged.
  await logAudit({
    organizationId: ticket.organization_id,
    actorUserId: actor.id,
    actorEmail: actor.email ?? null,
    action: "ticket.priority_change",
    entityType: "support_ticket",
    entityId: ticket.id,
    metadata: { from: ticket.priority, to: p },
  });

  revalidateTicket(ticket.id);
  return { ok: true };
}
