// Email fan-out for support tickets. Platform-branded both directions — this
// is platform <-> garage correspondence, never on a tenant's behalf. All
// senders are best-effort and never throw (callers fire them via after()).
import { sendEmail, renderPlatformEmail, tenantPortalUrl, paragraphsToHtml } from "@/lib/email";
import { emailButton, emailDetails, ACCENT_DEFAULT, type EmailDetailRow } from "@/lib/email-layout";
import {
  shortTicketRef,
  STATUS_LABELS,
  TYPE_LABELS,
  type SupportTicket,
  type TicketStatus,
} from "@/lib/support-tickets";

// Devops inbox for new-ticket + staff-reply notifications. Unset → skip
// loudly; the ticket still exists in /admin/support.
function platformSupportInbox(): string | null {
  const to = process.env.PLATFORM_SUPPORT_EMAIL;
  if (!to) {
    console.warn("[support-tickets] PLATFORM_SUPPORT_EMAIL unset — devops email skipped");
    return null;
  }
  return to;
}

// admin.<root> origin, matching the statusPageUrl construction in the admin
// layout: production root domain with the admin subdomain prefixed.
function adminTicketUrl(ticketId: string): string {
  const root =
    process.env.NEXT_PUBLIC_ROOT_DOMAIN && !process.env.NEXT_PUBLIC_ROOT_DOMAIN.includes("localtest")
      ? process.env.NEXT_PUBLIC_ROOT_DOMAIN
      : "ai-garage.co.uk";
  return `https://admin.${root}/admin/support/${ticketId}`;
}

function ticketDetailRows(ticket: SupportTicket, orgName: string): EmailDetailRow[] {
  const rows: EmailDetailRow[] = [
    { label: "Organisation", value: orgName },
    { label: "Type", value: TYPE_LABELS[ticket.type] },
    { label: "Requester", value: `${ticket.requester_name ?? "Unknown"} (${ticket.requester_email ?? "no email"})` },
  ];
  if (ticket.context.branch_name) rows.push({ label: "Branch", value: ticket.context.branch_name });
  const role = ticket.context.org_role ?? ticket.context.location_role;
  if (role) rows.push({ label: "Role", value: role });
  if (ticket.context.path) rows.push({ label: "Page", value: ticket.context.path });
  if (ticket.context.app_version) rows.push({ label: "App version", value: ticket.context.app_version });
  return rows;
}

export async function sendNewTicketEmailToPlatform(
  ticket: SupportTicket,
  orgName: string,
  body: string,
): Promise<void> {
  try {
    const to = platformSupportInbox();
    if (!to) return;
    const ref = shortTicketRef(ticket.id);
    const subject = `[Support] ${orgName} · ${TYPE_LABELS[ticket.type]}: ${ticket.subject} ${ref}`;
    const html = renderPlatformEmail({
      preheader: `New ${TYPE_LABELS[ticket.type].toLowerCase()} from ${orgName}`,
      heading: `New ${TYPE_LABELS[ticket.type].toLowerCase()} ${ref}`,
      bodyHtml:
        `<p style="margin:0 0 8px;font-weight:600">${escapeHtml(ticket.subject)}</p>` +
        paragraphsToHtml(body) +
        emailDetails(ticketDetailRows(ticket, orgName)) +
        emailButton({ url: adminTicketUrl(ticket.id), label: "Open in admin" }, ACCENT_DEFAULT),
    });
    await sendEmail({ to, subject, text: `${ticket.subject}\n\n${body}\n\n${adminTicketUrl(ticket.id)}`, html });
  } catch (err) {
    console.error("[support-tickets] new-ticket email failed", err);
  }
}

export async function sendStaffReplyEmailToPlatform(
  ticket: SupportTicket,
  orgName: string,
  body: string,
): Promise<void> {
  try {
    const to = platformSupportInbox();
    if (!to) return;
    const ref = shortTicketRef(ticket.id);
    const subject = `[Support] Reply from ${orgName}: ${ticket.subject} ${ref}`;
    const html = renderPlatformEmail({
      preheader: `Reply on ${ref} from ${orgName}`,
      heading: `Reply on ${ref}`,
      bodyHtml:
        paragraphsToHtml(body) +
        emailDetails(ticketDetailRows(ticket, orgName)) +
        emailButton({ url: adminTicketUrl(ticket.id), label: "Open in admin" }, ACCENT_DEFAULT),
    });
    await sendEmail({ to, subject, text: `${body}\n\n${adminTicketUrl(ticket.id)}`, html });
  } catch (err) {
    console.error("[support-tickets] staff-reply email failed", err);
  }
}

// Admin reply to the requester; when the same submit also changed the status,
// pass newStatus so ONE combined email goes out instead of two.
export async function sendAdminReplyEmailToRequester(
  ticket: SupportTicket,
  orgSlug: string,
  body: string,
  opts: { actingAdminEmail: string | null; newStatus?: TicketStatus | null },
): Promise<void> {
  try {
    if (!ticket.requester_email) return;
    // Never email the actor (an admin replying to their own test ticket).
    if (opts.actingAdminEmail && ticket.requester_email.toLowerCase() === opts.actingAdminEmail.toLowerCase()) return;
    const ref = shortTicketRef(ticket.id);
    const ticketUrl = tenantPortalUrl(orgSlug, `/staff/support/${ticket.id}`);
    const statusLine = opts.newStatus
      ? `<p style="margin:16px 0 0;color:#9aa1ab">Status updated to <strong>${STATUS_LABELS[opts.newStatus]}</strong>.</p>`
      : "";
    const html = renderPlatformEmail({
      preheader: `AI Garage Support replied on ${ref}`,
      heading: `Support replied ${ref}`,
      bodyHtml:
        `<p style="margin:0 0 8px;font-weight:600">${escapeHtml(ticket.subject)}</p>` +
        paragraphsToHtml(body) +
        statusLine +
        emailButton({ url: ticketUrl, label: "View the conversation" }, ACCENT_DEFAULT),
    });
    await sendEmail({
      to: ticket.requester_email,
      subject: `AI Garage Support replied: ${ticket.subject} ${ref}`,
      text: `${body}\n\n${opts.newStatus ? `Status: ${STATUS_LABELS[opts.newStatus]}\n\n` : ""}${ticketUrl}`,
      html,
    });
  } catch (err) {
    console.error("[support-tickets] admin-reply email failed", err);
  }
}

export async function sendStatusChangeEmailToRequester(
  ticket: SupportTicket,
  orgSlug: string,
  newStatus: TicketStatus,
  opts: { actingAdminEmail: string | null },
): Promise<void> {
  try {
    if (!ticket.requester_email) return;
    if (opts.actingAdminEmail && ticket.requester_email.toLowerCase() === opts.actingAdminEmail.toLowerCase()) return;
    const ref = shortTicketRef(ticket.id);
    const ticketUrl = tenantPortalUrl(orgSlug, `/staff/support/${ticket.id}`);
    const html = renderPlatformEmail({
      preheader: `Your ticket ${ref} is now ${STATUS_LABELS[newStatus]}`,
      heading: `Ticket ${ref}: ${STATUS_LABELS[newStatus]}`,
      bodyHtml:
        `<p style="margin:0 0 8px;font-weight:600">${escapeHtml(ticket.subject)}</p>` +
        `<p style="margin:0;color:#9aa1ab">Your ${TYPE_LABELS[ticket.type].toLowerCase()} is now <strong>${STATUS_LABELS[newStatus]}</strong>.</p>` +
        emailButton({ url: ticketUrl, label: "View the ticket" }, ACCENT_DEFAULT),
    });
    await sendEmail({
      to: ticket.requester_email,
      subject: `Ticket ${ref} is now ${STATUS_LABELS[newStatus]}: ${ticket.subject}`,
      text: `Your ticket "${ticket.subject}" is now ${STATUS_LABELS[newStatus]}.\n\n${ticketUrl}`,
      html,
    });
  } catch (err) {
    console.error("[support-tickets] status email failed", err);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
