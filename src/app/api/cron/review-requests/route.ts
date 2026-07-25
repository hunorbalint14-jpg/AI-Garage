import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeEqual } from "@/lib/safe-equal";
import { sendEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import { sendWhatsApp } from "@/lib/whatsapp";
import { logAudit } from "@/lib/audit";
import { generateReviewToken, hashReviewToken, tenantReviewUrl } from "@/lib/review-links";
import { recordCronRun } from "@/lib/platform/cron-runs";
import { garageLabel, addressOneLine } from "@/lib/garage-identity";
import { isPrelive } from "@/lib/prelive";
import { recordHeld, type HeldRow } from "@/lib/held-comms";

// Sends queued post-job feedback pulses (#508). Dispatched per-location by
// /api/cron/tick when the `review_requests` scheduled_task is due. Mints a
// fresh token at send time and stores only its hash. The customer's 1–5
// score routes on the /review page: 4–5 → the garage's Google review link,
// 1–3 → private feedback + a staff alert, review ask suppressed — the
// interception happens BEFORE any public ask.
export const runtime = "nodejs";
export const maxDuration = 60;

/** A customer isn't pulsed again within this window (repeat visits). */
const PULSE_CAP_DAYS = 30;

type LocationRow = {
  id: string;
  slug: string;
  name: string;
  address: string | null;
  live_at: string | null;
  organization: { id: string; slug: string; name: string } | null;
};

type QueuedRow = {
  id: string;
  customer_id: string | null;
  customer: { full_name: string | null; email: string | null; phone: string | null } | null;
};

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !safeEqual(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const filterLocationId = searchParams.get("location_id");

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const capSince = new Date(Date.now() - PULSE_CAP_DAYS * 24 * 60 * 60 * 1000).toISOString();

  let locationsQuery = admin
    .from("locations")
    .select("id, slug, name, address, live_at, organization:organizations!organization_id(id, slug, name)");
  if (filterLocationId) locationsQuery = locationsQuery.eq("id", filterLocationId);
  const { data: locations } = (await locationsQuery) as unknown as { data: LocationRow[] | null };

  const __t0 = Date.now();
  const results = { sent: 0, skipped: 0, suppressed: 0, prelive: 0, held: 0, failed: 0, errors: [] as string[] };
  const held: HeldRow[] = [];

  for (const location of locations ?? []) {
    // Prelive branches (#585) send no feedback pulses. The queue is still read
    // so the Go-live screen can show what's waiting (#586) — the rows stay
    // `queued`, no token is minted and nothing is marked sent or suppressed.
    const prelive = isPrelive(location);

    const { data: task } = await admin
      .from("scheduled_tasks")
      .select("enabled, settings")
      .eq("location_id", location.id)
      .eq("task_type", "review_requests")
      .maybeSingle();
    const taskRow = task as { enabled: boolean; settings: { channels?: string[] } | null } | null;
    if (taskRow && taskRow.enabled === false) continue;
    // Back-compat: rows seeded before #508 have empty settings → email only.
    const channels = taskRow?.settings?.channels ?? ["email"];

    const orgName = location.organization?.name ?? location.name;
    const garageName = garageLabel({ orgName, locationName: location.name });
    const addrLine = addressOneLine(location.address);
    const locationFooter = addrLine ? `\n\n📍 ${addrLine}` : "";
    // Tenant subdomain resolves the ORGANISATION slug — using the branch slug
    // built dead links for every non-main branch.
    const tenantSlug = location.organization?.slug ?? location.slug;

    const { data: queued } = (await admin
      .from("review_requests")
      .select("id, customer_id, customer:customers(full_name, email, phone)")
      .eq("location_id", location.id)
      .eq("status", "queued")
      .limit(200)) as unknown as { data: QueuedRow[] | null };
    const rows = queued ?? [];
    if (rows.length === 0) continue;

    // Frequency cap: customers already pulsed inside the window (any branch
    // of the org — customers are org-global) are suppressed, not failed.
    const customerIds = [...new Set(rows.map((r) => r.customer_id).filter((c): c is string => !!c))];
    const { data: recent } = await admin
      .from("review_requests")
      .select("customer_id")
      .in("customer_id", customerIds)
      .gte("sent_at", capSince)
      .in("status", ["sent", "responded"]);
    const recentlyPulsed = new Set(
      ((recent ?? []) as { customer_id: string | null }[]).map((r) => r.customer_id).filter((c): c is string => !!c),
    );

    if (prelive) {
      for (const row of rows) {
        if (row.customer_id && recentlyPulsed.has(row.customer_id)) continue;
        held.push({
          locationId: location.id,
          kind: "review_request",
          customerId: row.customer_id,
          refTable: "review_requests",
          refId: row.id,
          summary: `Feedback request for ${row.customer?.full_name ?? "a customer"}`,
        });
        results.prelive++;
      }
      continue;
    }

    for (const row of rows) {
      if (row.customer_id && recentlyPulsed.has(row.customer_id)) {
        await admin.from("review_requests").update({ status: "suppressed" }).eq("id", row.id);
        results.suppressed++;
        continue;
      }

      const email = row.customer?.email ?? null;
      const phone = row.customer?.phone ?? null;
      const canEmail = channels.includes("email") && !!email;
      const canSms = channels.includes("sms") && !!phone;
      const canWhatsApp = channels.includes("whatsapp") && !!phone;
      if (!canEmail && !canSms && !canWhatsApp) {
        await admin.from("review_requests").update({ status: "failed" }).eq("id", row.id);
        results.skipped++;
        continue;
      }

      const token = generateReviewToken();
      const url = tenantReviewUrl(tenantSlug, token);
      const firstName = row.customer?.full_name?.split(" ")[0] ?? "there";
      const sentChannels: string[] = [];

      if (canEmail) {
        const res = await sendEmail({
          to: email!,
          subject: `How was your visit to ${garageName}?`,
          text:
            `Hi ${firstName},\n\n` +
            `Thanks for choosing ${garageName}. We'd really appreciate a moment of your time to tell us how we did — it helps us keep improving.\n\n` +
            `Just tap the button below to leave your feedback.\n\n` +
            `Thank you,\n${garageName}${locationFooter}`,
          cta: { url, label: "Leave feedback" },
        });
        if (res.success) sentChannels.push("email");
      }
      if (canSms && sentChannels.length === 0) {
        // SMS is the fallback pulse, not a duplicate — one channel per ask.
        const res = await sendSms({
          to: phone!,
          body: `Hi ${firstName}, thanks for visiting ${garageName}. How did we do? Rate us in one tap: ${url}`,
        });
        if (res.success) sentChannels.push("sms");
      }
      if (canWhatsApp && sentChannels.length === 0) {
        const res = await sendWhatsApp({
          to: phone!,
          body: `Hi ${firstName}, thanks for visiting ${garageName}. How did we do? Rate us in one tap: ${url}`,
        });
        if (res.success) sentChannels.push("whatsapp");
      }

      if (sentChannels.length > 0) {
        await admin
          .from("review_requests")
          .update({ status: "sent", sent_at: nowIso, token_hash: hashReviewToken(token), channel: sentChannels[0] })
          .eq("id", row.id);
        await logAudit({
          organizationId: location.organization?.id ?? null,
          action: "review.requested",
          entityType: "review_request",
          entityId: row.id,
          metadata: { channels: sentChannels },
        });
        results.sent++;
      } else {
        await admin.from("review_requests").update({ status: "failed" }).eq("id", row.id);
        results.failed++;
        results.errors.push(`${row.id}: no channel succeeded`);
      }
    }
  }

  results.held = await recordHeld(admin, held);

  console.log("[cron/review-requests]", results);
  await recordCronRun(
    admin,
    "cron/review-requests",
    results.failed === 0,
    Date.now() - __t0,
    `sent ${results.sent}, suppressed ${results.suppressed}, failed ${results.failed}`,
  );
  return NextResponse.json({ success: true, ...results });
}
