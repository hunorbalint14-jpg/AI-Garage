import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

// Canonical action vocabulary. Adding a new value? Use the
// "<entity>.<verb>" pattern so future filtering stays sane.
export type AuditAction =
  // Org / location settings
  | "settings.update"
  | "settings.business_hours_update"
  | "settings.logo_upload"
  | "settings.location_add"
  // Stripe Connect
  | "stripe.connect_start"
  | "stripe.connect_complete"
  | "stripe.dashboard_open"
  | "stripe.status_refresh"
  // Xero
  | "xero.connect_complete"
  | "xero.disconnect"
  // Compliance
  | "dpa.accept"
  | "impersonation.start"
  | "impersonation.stop"
  // Doc shares
  | "doc_share.mint"
  | "doc_share.revoke"
  // Passkeys
  | "passkey.register"
  | "passkey.revoke"
  // Customers (GDPR-sensitive)
  | "customer.create"
  | "customer.update"
  | "customer.delete"
  | "customer.hard_delete"
  | "customer.anonymize"
  | "customer.consent_update"
  | "customer.data_export"
  // Vehicles
  | "vehicle.create"
  | "vehicle.delete"
  // Invoices (financial)
  | "invoice.create"
  | "invoice.send"
  | "invoice.mark_paid"
  | "invoice.delete"
  // Services / products (pricing trail)
  | "service.upsert"
  | "service.toggle_active"
  | "service.delete"
  | "product.create"
  | "product.update"
  | "product.delete"
  | "product.stock_adjust"
  // Staff access management
  | "staff.invite"
  | "staff.password_reset"
  | "staff.password_set"
  | "staff.mfa_reset"
  | "staff.permissions_update"
  | "staff.role_change"
  | "staff.remove"
  | "staff.template_assign"
  | "staff.mot_flag_change"
  // Role templates
  | "role_template.create"
  | "role_template.update"
  | "role_template.delete"
  // Communications (spam / abuse trail)
  | "reminder.send"
  | "campaign.send"
  | "message.send"
  // DVI / mid-job upsell quotes
  | "quote.create"
  | "quote.send"
  | "quote.cancel"
  | "quote.view"
  | "quote.approve"
  | "quote.decline"
  | "quote.rebook"
  | "quote.expire"
  | "quote.deposit_paid"
  // Standalone (pre-job) quotes
  | "standalone_quote.create"
  | "standalone_quote.send"
  | "standalone_quote.cancel"
  | "standalone_quote.view"
  | "standalone_quote.approve"
  | "standalone_quote.decline"
  | "standalone_quote.expire"
  | "standalone_quote.deposit_paid";

type LogArgs = {
  organizationId?: string | null;
  actorUserId?: string | null;
  actorEmail?: string | null;
  action: AuditAction;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
};

// Fire-and-forget audit write. Never throws — failures only log to stderr
// so the caller's main path can't be broken by an audit-table issue.
export async function logAudit(args: LogArgs): Promise<void> {
  try {
    const admin = createAdminClient();
    let ip: string | null = null;
    let ua: string | null = null;
    try {
      const h = await headers();
      ip =
        h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        h.get("x-real-ip") ??
        null;
      ua = h.get("user-agent") ?? null;
    } catch {
      // headers() throws outside a request context — acceptable for cron
      // and webhook callers; they pass actorUserId explicitly.
    }
    await admin.from("audit_log").insert({
      organization_id: args.organizationId ?? null,
      actor_user_id: args.actorUserId ?? null,
      actor_email: args.actorEmail ?? null,
      action: args.action,
      entity_type: args.entityType ?? null,
      entity_id: args.entityId ?? null,
      metadata: args.metadata ?? {},
      ip_address: ip,
      user_agent: ua,
    });
  } catch (err) {
    console.error("[audit] log failed", { action: args.action, err });
  }
}
