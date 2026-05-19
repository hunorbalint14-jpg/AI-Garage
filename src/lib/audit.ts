import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

// Canonical action vocabulary. Adding a new value? Use the
// "<entity>.<verb>" pattern so future filtering stays sane.
export type AuditAction =
  | "settings.update"
  | "settings.business_hours_update"
  | "settings.logo_upload"
  | "settings.location_add"
  | "stripe.connect_start"
  | "stripe.connect_complete"
  | "stripe.dashboard_open"
  | "stripe.status_refresh"
  | "xero.connect_complete"
  | "xero.disconnect"
  | "dpa.accept"
  | "impersonation.start"
  | "impersonation.stop"
  | "doc_share.mint"
  | "doc_share.revoke"
  | "passkey.register"
  | "passkey.revoke";

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
