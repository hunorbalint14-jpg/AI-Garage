import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeEqual } from "@/lib/safe-equal";
import { logAudit } from "@/lib/audit";
import { recordCronRun } from "@/lib/platform/cron-runs";
import { decrypt } from "@/lib/encryption";
import { tenantQuoteUrl } from "@/lib/quote-links";
import { isPrelive } from "@/lib/prelive";
import {
  dueReminderDay,
  dispatchQuoteReminder,
  normaliseReminderDays,
  REMINDER_MAX_LIMIT,
  type ReminderChannel,
} from "@/lib/quote-reminders";

export const runtime = "nodejs";
export const maxDuration = 60;

// Sweeps pending quotes that passed their expires_at and flips them to
// "expired" + audit-logs each one. Covers BOTH the DVI mid-job quotes
// (quote_type='job') and the pre-job standalone quotes (quote_type='standalone').
// Then runs the automated reminder pass (Phase 6, #246) over the quotes that
// are still pending, per each org's reminder schedule.

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !safeEqual(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const __t0 = Date.now();
  const nowIso = new Date().toISOString();

  // Single sweep across the unified quotes table (both DVI job quotes and
  // standalone quotes live here now).
  type Row = { id: string; quote_type: "job" | "standalone"; job_id: string | null; organization_id: string; total: number };
  const { data: stale } = await admin
    .from("quotes")
    .select("id, quote_type, job_id, organization_id, total")
    .eq("status", "pending")
    .lt("expires_at", nowIso);
  const rows = (stale ?? []) as Row[];

  let jobExpired = 0;
  let standaloneExpired = 0;

  if (rows.length > 0) {
    const { error } = await admin
      .from("quotes")
      .update({ status: "expired" })
      .in("id", rows.map((r) => r.id))
      .eq("status", "pending");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    for (const r of rows) {
      await logAudit({
        organizationId: r.organization_id,
        action: "quote.expire",
        entityType: r.quote_type === "job" ? "job_quote" : "standalone_quote",
        entityId: r.id,
        metadata: r.quote_type === "job" ? { job_id: r.job_id, total: r.total } : { total: r.total },
      });
      if (r.quote_type === "job") jobExpired++;
      else standaloneExpired++;
    }
  }

  const reminded = await processQuoteReminders(admin, nowIso);

  await recordCronRun(
    admin,
    "cron/quote-expiry",
    true,
    Date.now() - __t0,
    `expired ${jobExpired + standaloneExpired}, reminded ${reminded}`,
  );
  return NextResponse.json({
    success: true,
    expired: jobExpired + standaloneExpired,
    job_expired: jobExpired,
    standalone_expired: standaloneExpired,
    reminded,
  });
}

// Automated quote reminders. A quote gets a nudge when one of its org's
// scheduled days (e.g. day 3, day 7 after send) has arrived, capped at the
// org's max (manual reminders count toward it), never after expiry. The
// customer link is rebuilt from the encrypted raw token, so the original
// link keeps working. Quotes sent before that column existed are skipped.
type PersonRef = { full_name: string | null; email: string | null; phone: string | null } | null;

type ReminderCandidate = {
  id: string;
  quote_type: "job" | "standalone";
  organization_id: string;
  slug: string | null;
  title: string | null;
  total: number;
  expires_at: string | null;
  sent_at: string | null;
  last_reminder_at: string | null;
  reminder_count: number;
  sent_channels: string[] | null;
  link_token_encrypted: string | null;
  customer: PersonRef;
  vehicle: { registration: string | null } | null;
  job: { customer: PersonRef; vehicle: { registration: string | null } | null } | null;
  location: { slug: string; name: string; address: string | null; live_at: string | null } | null;
  organization: {
    slug: string;
    name: string;
    quote_reminders_enabled: boolean | null;
    quote_reminder_days: number[] | null;
    quote_reminder_max: number | null;
  } | null;
};

// Serial sends inside a 60s window — keep the batch small; the 30-min cadence
// drains any backlog.
const REMINDER_BATCH = 50;

async function processQuoteReminders(
  admin: ReturnType<typeof createAdminClient>,
  nowIso: string,
): Promise<number> {
  const { data, error } = await admin
    .from("quotes")
    .select(
      "id, quote_type, organization_id, slug, title, total, expires_at, sent_at, last_reminder_at, reminder_count, sent_channels, link_token_encrypted, customer:customers(full_name, email, phone), vehicle:vehicles(registration), job:jobs(customer:customers(full_name, email, phone), vehicle:vehicles(registration)), location:locations(slug, name, address, live_at), organization:organizations!organization_id(slug, name, quote_reminders_enabled, quote_reminder_days, quote_reminder_max)",
    )
    .eq("status", "pending")
    .gt("expires_at", nowIso)
    .not("sent_at", "is", null)
    .not("link_token_encrypted", "is", null)
    .order("sent_at", { ascending: true })
    .limit(500);
  if (error) {
    console.error("[quote-reminders] fetch failed", error.message);
    return 0;
  }

  let reminded = 0;
  for (const q of (data ?? []) as unknown as ReminderCandidate[]) {
    if (reminded >= REMINDER_BATCH) break;
    const org = q.organization;
    if (!org || org.quote_reminders_enabled === false) continue;

    const reminderDays = normaliseReminderDays(org.quote_reminder_days ?? [3, 7]);
    const reminderMax = Math.min(
      Math.max(Number(org.quote_reminder_max ?? 2) || 2, 1),
      REMINDER_MAX_LIMIT,
    );
    if (!q.sent_at || reminderDays.length === 0) continue;

    const dueDay = dueReminderDay({
      sentAt: q.sent_at,
      lastReminderAt: q.last_reminder_at,
      reminderCount: q.reminder_count ?? 0,
      reminderDays,
      reminderMax,
      expiresAt: q.expires_at,
    });
    if (dueDay === null) continue;

    const customer = q.quote_type === "job" ? q.job?.customer ?? null : q.customer;
    if (!customer || (!customer.email && !customer.phone)) continue;
    if (!q.slug || !q.link_token_encrypted || !q.location) continue;
    // Prelive branches (#585) send no unattended chasers. Expiry itself still
    // runs — that's a status change on our side, not a message to anyone.
    if (isPrelive(q.location)) continue;

    // Reuse the channels of the original send; fall back to email+SMS for
    // rows from before sent_channels existed.
    const channels = ((q.sent_channels?.length ? q.sent_channels : ["email", "sms"]) as ReminderChannel[]).filter(
      (c) => (c === "email" ? !!customer.email : !!customer.phone),
    );
    if (channels.length === 0) continue;

    let url: string;
    try {
      url = tenantQuoteUrl(q.organization!.slug, q.slug, decrypt(q.link_token_encrypted));
    } catch (e) {
      console.error("[quote-reminders] token decrypt failed", { quote: q.id, error: (e as Error).message });
      continue;
    }

    const result = await dispatchQuoteReminder({
      customer,
      vehicleReg: (q.quote_type === "job" ? q.job?.vehicle : q.vehicle)?.registration ?? null,
      title: q.title,
      total: Number(q.total ?? 0),
      garageName: org.name,
      locationName: q.location.name,
      address: q.location.address,
      expiresAt: q.expires_at,
      url,
      channels,
    });
    // Nothing delivered → leave the row untouched so the next run retries.
    if (result.channels.length === 0) continue;

    await admin
      .from("quotes")
      .update({
        last_reminder_at: new Date().toISOString(),
        reminder_count: (q.reminder_count ?? 0) + 1,
      })
      .eq("id", q.id);

    await logAudit({
      organizationId: q.organization_id,
      action: "quote.reminder_sent",
      entityType: q.quote_type === "job" ? "job_quote" : "standalone_quote",
      entityId: q.id,
      metadata: { type: "auto", day: dueDay, channels: result.channels, total: q.total },
    });
    reminded++;
  }

  return reminded;
}
