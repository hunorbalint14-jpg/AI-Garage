import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/staff/page-header";
import { AuditTable, type AuditRow } from "./audit-table";

export const dynamic = "force-dynamic";

const ACTION_GROUPS: { label: string; actions: string[] }[] = [
  {
    label: "GDPR",
    actions: ["customer.create", "customer.update", "customer.delete", "customer.hard_delete", "customer.anonymize", "customer.consent_update", "customer.data_export"],
  },
  {
    label: "Financial",
    actions: ["invoice.create", "invoice.send", "invoice.mark_paid", "invoice.delete", "stripe.connect_start", "stripe.connect_complete", "stripe.dashboard_open", "stripe.status_refresh"],
  },
  {
    label: "Quotes",
    actions: ["quote.create", "quote.send", "quote.cancel", "quote.approve", "quote.decline", "quote.rebook", "quote.expire", "quote.deposit_paid", "standalone_quote.create", "standalone_quote.send", "standalone_quote.cancel", "standalone_quote.approve", "standalone_quote.decline", "standalone_quote.expire", "standalone_quote.deposit_paid"],
  },
  {
    label: "Integrations",
    actions: ["xero.connect_complete", "xero.disconnect"],
  },
  {
    label: "Auth",
    actions: ["passkey.register", "passkey.revoke", "impersonation.start", "impersonation.stop", "staff.invite", "staff.password_reset", "staff.password_set", "staff.mfa_reset", "staff.permissions_update", "staff.role_change", "staff.remove"],
  },
];

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; actor?: string; group?: string; cursor?: string }>;
}) {
  const ctx = await requireStaffContext();
  // Defence in depth — RLS already filters but we also block the page.
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") notFound();

  const sp = await searchParams;
  const actionFilter = sp.action?.trim();
  const actorFilter = sp.actor?.trim();
  const groupFilter = sp.group?.trim();
  const cursor = sp.cursor;

  const admin = createAdminClient();
  let query = admin
    .from("audit_log")
    .select("id, organization_id, actor_user_id, actor_email, action, entity_type, entity_id, metadata, ip_address, user_agent, created_at")
    .eq("organization_id", ctx.organization.id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (cursor) query = query.lt("created_at", cursor);
  if (actionFilter) query = query.eq("action", actionFilter);
  if (actorFilter) query = query.ilike("actor_email", `%${actorFilter}%`);
  if (groupFilter) {
    const group = ACTION_GROUPS.find((g) => g.label.toLowerCase() === groupFilter.toLowerCase());
    if (group) query = query.in("action", group.actions);
  }

  const { data } = await query;
  const rows = (data ?? []) as AuditRow[];

  const lastCreatedAt = rows.length === 100 ? rows[rows.length - 1].created_at : null;

  return (
    <div className="flex flex-col gap-6 max-w-6xl">
      <PageHeader
        title="Audit log"
        description="Append-only trail of staff actions. Visible only to org owners and admins. Tenant-scoped via RLS."
      />

      <div className="rounded-lg border p-4 flex flex-col gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Filter by category</h2>
        <div className="flex flex-wrap gap-1">
          <Link
            href={`/staff/audit-log${actorFilter ? `?actor=${encodeURIComponent(actorFilter)}` : ""}`}
            className={
              "rounded-full px-3 py-1 text-xs font-medium " +
              (!groupFilter && !actionFilter ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-muted/70")
            }
          >
            All
          </Link>
          {ACTION_GROUPS.map((g) => {
            const params = new URLSearchParams();
            params.set("group", g.label);
            if (actorFilter) params.set("actor", actorFilter);
            const active = groupFilter?.toLowerCase() === g.label.toLowerCase();
            return (
              <Link
                key={g.label}
                href={`/staff/audit-log?${params.toString()}`}
                className={
                  "rounded-full px-3 py-1 text-xs font-medium " +
                  (active ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-muted/70")
                }
              >
                {g.label}
              </Link>
            );
          })}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">No audit entries match these filters.</p>
        </div>
      ) : (
        <AuditTable rows={rows} initialActor={actorFilter ?? ""} />
      )}

      {lastCreatedAt && (
        <div className="flex justify-center">
          <Link
            href={`/staff/audit-log?cursor=${encodeURIComponent(lastCreatedAt)}${groupFilter ? `&group=${encodeURIComponent(groupFilter)}` : ""}${actionFilter ? `&action=${encodeURIComponent(actionFilter)}` : ""}${actorFilter ? `&actor=${encodeURIComponent(actorFilter)}` : ""}`}
            className="text-sm underline text-muted-foreground hover:text-foreground"
          >
            Older entries →
          </Link>
        </div>
      )}
    </div>
  );
}
