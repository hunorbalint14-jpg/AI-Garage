import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeEqual } from "@/lib/safe-equal";
import { getAccountingConnection } from "@/lib/accounting/connection";
import { PROVIDER_LABELS, type AccountingProviderId } from "@/lib/accounting/types";
import { runAccountingBackfill } from "@/lib/accounting/backfill";
import { sendEmail, renderPlatformEmail, paragraphsToHtml } from "@/lib/email";
import { recordCronRun } from "@/lib/platform/cron-runs";

export const runtime = "nodejs";
export const maxDuration = 300;

// Daily accounting-link maintenance (dispatched from /api/cron/tick's 09:00
// pass). Three jobs per connected org:
//   1. Touch the connection — the token refresh this triggers is what keeps
//      Sage refresh tokens (31-day unused expiry) and QuickBooks refresh
//      tokens (~100-day) alive through a garage's quiet month.
//   2. If the refresh fails, getAccountingConnection marks needs_reconnect;
//      the first time we see that, email the org owner to reconnect (a dead
//      link is an MTD digital-link outage, not a cosmetic gap).
//   3. Sweep unsynced records (runAccountingBackfill) — recovery no longer
//      depends on an owner finding the retry button.

const PER_ORG_CAP = 10;

type ConnRow = {
  organization_id: string;
  provider: AccountingProviderId;
  connected_at: string;
  needs_reconnect: boolean;
  reconnect_alerted_at: string | null;
};

async function alertOwnerReconnect(orgId: string, provider: AccountingProviderId): Promise<boolean> {
  const admin = createAdminClient();
  const [{ data: org }, { data: owner }] = await Promise.all([
    admin.from("organizations").select("name, slug").eq("id", orgId).maybeSingle(),
    admin
      .from("org_users")
      .select("user_id")
      .eq("organization_id", orgId)
      .eq("role", "owner")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  const userId = (owner as { user_id: string } | null)?.user_id;
  if (!userId) return false;
  const { data: u } = await admin.auth.admin.getUserById(userId);
  const email = u?.user?.email;
  if (!email) return false;

  const orgName = (org as { name: string } | null)?.name ?? "your garage";
  const label = PROVIDER_LABELS[provider];
  const intro =
    `The ${label} connection for ${orgName} has stopped working — the saved authorisation has expired, ` +
    `so invoices and payments are NO LONGER flowing into ${label}.\n\n` +
    `Until it's reconnected, anything issued now will only sync after you reconnect (we backfill automatically), ` +
    `and your books drift out of date. Reconnecting takes under a minute:`;

  const result = await sendEmail({
    to: email,
    subject: `Action needed: reconnect ${label} for ${orgName}`,
    text: `${intro}\n\nGo to Settings → Integrations → ${label} → Reconnect.`,
    html: renderPlatformEmail({
      preheader: `${label} sync has stopped — reconnect to keep your books up to date.`,
      badge: "Accounting sync",
      heading: `Reconnect ${label}`,
      bodyHtml:
        paragraphsToHtml(intro) +
        paragraphsToHtml(`Settings → Integrations → ${label} → Reconnect.`),
      footerNote: "You're receiving this because you own this organisation on AI Garage.",
    }),
  });
  return result.success;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !safeEqual(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const t0 = Date.now();

  const { data } = await admin
    .from("accounting_connections")
    .select("organization_id, provider, connected_at, needs_reconnect, reconnect_alerted_at");
  const rows = (data ?? []) as ConnRow[];

  const results = { orgs: rows.length, attempted: 0, synced: 0, alerted: 0, dead: 0, revoked: 0 };

  // Alert the owner once per reconnect episode (reconnect_alerted_at is
  // reset when an episode opens and cleared when it closes). Returns
  // whether an episode is currently open.
  const alertIfEpisodeOpen = async (orgId: string, provider: AccountingProviderId): Promise<boolean> => {
    const { data: fresh } = await admin
      .from("accounting_connections")
      .select("needs_reconnect, reconnect_alerted_at")
      .eq("organization_id", orgId)
      .maybeSingle();
    const f = fresh as { needs_reconnect: boolean; reconnect_alerted_at: string | null } | null;
    if (!f?.needs_reconnect) return false;
    if (!f.reconnect_alerted_at) {
      const sent = await alertOwnerReconnect(orgId, provider);
      if (sent) {
        results.alerted++;
        await admin
          .from("accounting_connections")
          .update({ reconnect_alerted_at: new Date().toISOString() })
          .eq("organization_id", orgId);
      }
    }
    return true;
  };

  for (const row of rows) {
    // Touch (refresh keepalive + reconnect detection)…
    const conn = await getAccountingConnection(row.organization_id);
    if (!conn) {
      results.dead++;
      // …and alert the owner once per failure episode.
      await alertIfEpisodeOpen(row.organization_id, row.provider);
      continue;
    }

    try {
      const { attempted, synced } = await runAccountingBackfill(
        row.organization_id,
        row.connected_at,
        PER_ORG_CAP,
      );
      results.attempted += attempted;
      results.synced += synced;
    } catch (e) {
      console.error("[cron/accounting-backfill] sweep failed", { orgId: row.organization_id }, e);
    }

    // Tenant-revoked mode: the refresh above SUCCEEDED but the provider
    // rejects every push (Xero 403 AuthenticationUnsuccessful after a
    // Connected-Apps disconnect). The backfill attempts just ran through
    // logSync, which opens the episode — check and alert in the same run.
    if (await alertIfEpisodeOpen(row.organization_id, row.provider)) results.revoked++;
  }

  await recordCronRun(
    admin,
    "cron/accounting-backfill",
    true,
    Date.now() - t0,
    `orgs ${results.orgs}, synced ${results.synced}/${results.attempted}, dead ${results.dead}, revoked ${results.revoked}, alerted ${results.alerted}`,
  );

  console.log("[cron/accounting-backfill]", results);
  return NextResponse.json({ success: true, ...results });
}
