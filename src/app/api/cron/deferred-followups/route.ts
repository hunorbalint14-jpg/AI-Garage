import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeEqual } from "@/lib/safe-equal";
import { sendEmail, tenantBookingUrl } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import { logAudit } from "@/lib/audit";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { recordCronRun } from "@/lib/platform/cron-runs";
import { garageLabel, garageLocationBlock, garageLocationInline } from "@/lib/garage-identity";
import { getOrgAiBrief } from "@/lib/ai-profile";
import { createInspectionReadUrls } from "@/lib/inspection-media";
import {
  DEFAULT_FOLLOWUP_DAYS,
  FOLLOWUP_CAP_DAYS,
  generateDeferredBookToken,
  hashDeferredBookToken,
  groupDueRecords,
  type FollowupRecord,
} from "@/lib/deferred-followup";
import { draftDeferredFollowup, fallbackFollowupEmail, fallbackFollowupSms, type FollowupDraftInput } from "@/lib/ai-deferred";
import { isPrelive } from "@/lib/prelive";
import { recordHeld, type HeldRow } from "@/lib/held-comms";

// Deferred-work follow-up sequence (#498 PR 3). Dispatched per-location by
// /api/cron/tick when the `deferred_followups` scheduled task is due (the
// task's hour is the quiet-hours control). One message per (customer,
// vehicle) per run, at most one nag per customer per 7 days across this
// sequence AND the reminder crons. Gated behind the global
// `deferred_followups` feature flag for staged rollout.
export const runtime = "nodejs";
export const maxDuration = 60;

const PHOTO_URL_TTL_SECONDS = 7 * 24 * 60 * 60; // outlives the email inbox lag

type LocationRow = {
  id: string;
  slug: string;
  name: string;
  address: string | null;
  live_at: string | null;
  organization: {
    id: string;
    slug: string;
    name: string;
    deferred_followup_days: number[] | null;
  } | null;
};

type RecordRow = FollowupRecord & {
  customer: { id: string; full_name: string | null; email: string | null; phone: string | null } | null;
  vehicle: { id: string; registration: string | null; make: string | null; model: string | null } | null;
};

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !safeEqual(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await isFeatureEnabled("deferred_followups"))) {
    return NextResponse.json({ success: true, gated: true, sent: 0 });
  }

  const { searchParams } = new URL(request.url);
  const filterLocationId = searchParams.get("location_id");

  const admin = createAdminClient();
  const __t0 = Date.now();
  const now = new Date();
  const nowIso = now.toISOString();
  const results = { sent: 0, skipped: 0, prelive: 0, held: 0, failed: 0, errors: [] as string[] };
  const held: HeldRow[] = [];

  let locationsQuery = admin
    .from("locations")
    .select(
      "id, slug, name, address, live_at, organization:organizations!organization_id(id, slug, name, deferred_followup_days)",
    );
  if (filterLocationId) locationsQuery = locationsQuery.eq("id", filterLocationId);
  const { data: locations } = (await locationsQuery) as unknown as { data: LocationRow[] | null };

  for (const location of locations ?? []) {
    // Prelive branches (#585) chase no deferred work; the due batches are still
    // worked out so the Go-live screen can list them (#586).
    const prelive = isPrelive(location);

    const org = location.organization;
    if (!org) continue;

    const { data: task } = await admin
      .from("scheduled_tasks")
      .select("enabled, settings")
      .eq("location_id", location.id)
      .eq("task_type", "deferred_followups")
      .maybeSingle();
    // Opt-in per location: no task row (org never opened Automations) or a
    // disabled one both mean no sends.
    const taskRow = task as { enabled: boolean; settings: { channels?: string[] } | null } | null;
    if (!taskRow || taskRow.enabled === false) continue;
    const channels = taskRow.settings?.channels ?? ["email", "sms"];

    const offsets =
      Array.isArray(org.deferred_followup_days) && org.deferred_followup_days.length > 0
        ? org.deferred_followup_days
        : DEFAULT_FOLLOWUP_DAYS;

    const { data: recordRows } = await admin
      .from("deferred_work")
      .select(
        "id, customer_id, vehicle_id, inspection_item_id, description, price, rag, followup_count, last_followup_at, created_at, customer:customers(id, full_name, email, phone), vehicle:vehicles(id, registration, make, model)",
      )
      .eq("location_id", location.id)
      .eq("status", "open")
      .not("customer_id", "is", null)
      .limit(500);
    const records = (recordRows ?? []) as unknown as RecordRow[];
    if (records.length === 0) continue;

    // Cap half 2: customers any other automated system reached inside the
    // window — vehicle reminders AND the post-service feedback pulse (#508).
    const customerIds = [...new Set(records.map((r) => r.customer_id).filter((c): c is string => !!c))];
    const since = new Date(now.getTime() - FOLLOWUP_CAP_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const [{ data: recentReminders }, { data: recentPulses }] = await Promise.all([
      admin.from("reminders").select("customer_id").in("customer_id", customerIds).gte("sent_at", since),
      admin
        .from("review_requests")
        .select("customer_id")
        .in("customer_id", customerIds)
        .gte("sent_at", since)
        .in("status", ["sent", "responded"]),
    ]);
    const recentlyContacted = new Set(
      [...((recentReminders ?? []) as { customer_id: string | null }[]), ...((recentPulses ?? []) as { customer_id: string | null }[])]
        .map((r) => r.customer_id)
        .filter((c): c is string => !!c),
    );

    const batches = groupDueRecords(records, offsets, recentlyContacted, now);
    if (batches.length === 0) continue;

    // Held (#586): record the due batches and stop before the AI draft, so a
    // prelive branch accrues no Claude spend and no followup_count is bumped.
    if (prelive) {
      const byIdPre = new Map(records.map((r) => [r.id, r]));
      for (const batch of batches) {
        const first = byIdPre.get(batch.records[0].id);
        const customer = first?.customer;
        if (!first || !customer || (!customer.email && !customer.phone)) continue;
        held.push({
          locationId: location.id,
          kind: "deferred_followup",
          customerId: customer.id,
          refTable: "deferred_work",
          refId: first.id,
          summary: `${customer.full_name ?? "Customer"} — ${batch.records.length} deferred item${batch.records.length === 1 ? "" : "s"}${first.vehicle?.registration ? ` on ${first.vehicle.registration}` : ""}`,
        });
        results.prelive++;
      }
      continue;
    }

    const aiBrief = await getOrgAiBrief(admin, org.id).catch(() => null);
    const identity = { orgName: org.name, locationName: location.name, address: location.address };
    const label = garageLabel(identity);
    const byId = new Map(records.map((r) => [r.id, r]));

    for (const batch of batches) {
      const first = byId.get(batch.records[0].id)!;
      const customer = first.customer;
      if (!customer || (!customer.email && !customer.phone)) {
        results.skipped++;
        continue;
      }

      const firstName = customer.full_name?.split(" ")[0] ?? "there";
      const reg = first.vehicle?.registration ?? "your vehicle";
      const vehicleDescription =
        [first.vehicle?.registration, [first.vehicle?.make, first.vehicle?.model].filter(Boolean).join(" ")]
          .filter(Boolean)
          .join(" · ") || "your vehicle";

      // Claim the batch BEFORE sending so a crash can't double-send; rolled
      // back if no channel succeeds.
      const token = generateDeferredBookToken();
      const recordIds = batch.records.map((r) => r.id);
      const { error: claimErr } = await admin
        .from("deferred_work")
        .update({
          book_token_hash: hashDeferredBookToken(token),
          followup_count: batch.stage,
          last_followup_at: nowIso,
          updated_at: nowIso,
        })
        .in("id", recordIds)
        .eq("status", "open");
      if (claimErr) {
        results.failed++;
        results.errors.push(`claim ${customer.id}: ${claimErr.message}`);
        continue;
      }

      const bookUrl = tenantBookingUrl(org.slug, `/book?dw=${token}`);
      const draftInput: FollowupDraftInput = {
        garageName: label,
        customerFirstName: firstName,
        vehicleDescription,
        items: batch.records.map((r) => ({ description: r.description, price: r.price, rag: r.rag })),
        stage: batch.stage,
        aiBrief,
      };

      let emailBody: string;
      let smsBody: string;
      try {
        const draft = await draftDeferredFollowup(draftInput, {
          locationId: location.id,
          organizationId: org.id,
          feature: "deferred_followup_draft",
        });
        emailBody = draft.email;
        smsBody = draft.sms;
      } catch {
        emailBody = fallbackFollowupEmail(draftInput);
        smsBody = fallbackFollowupSms(draftInput);
      }

      // Finding photos: signed links appended to the email (long TTL — the
      // email sits in an inbox, not a browser session).
      const itemIds = batch.records
        .map((r) => r.inspection_item_id)
        .filter((i): i is string => !!i);
      if (itemIds.length > 0) {
        const { data: media } = await admin
          .from("inspection_media")
          .select("storage_path, inspection_item_id")
          .in("inspection_item_id", itemIds)
          .limit(6);
        const paths = ((media ?? []) as { storage_path: string }[]).map((m) => m.storage_path);
        if (paths.length > 0) {
          const urls = await createInspectionReadUrls(paths, PHOTO_URL_TTL_SECONDS);
          const links = [...urls.values()].slice(0, 3);
          if (links.length > 0) {
            emailBody += `\n\n${links.length === 1 ? "Photo of what we found" : "Photos of what we found"}:\n${links.join("\n")}`;
          }
        }
      }

      emailBody += `\n\n${garageLocationBlock(identity)}`;

      const sentChannels: string[] = [];
      if (channels.includes("email") && customer.email) {
        const res = await sendEmail({
          to: customer.email,
          subject: `Still outstanding for ${reg} — ${label}`,
          text: emailBody,
          cta: { url: bookUrl, label: "Book it in" },
        });
        if (res.success) sentChannels.push("email");
      }
      if (channels.includes("sms") && customer.phone) {
        const res = await sendSms({
          to: customer.phone,
          body: `${smsBody} ${bookUrl} — ${garageLocationInline(identity)}`,
        });
        if (res.success) sentChannels.push("sms");
      }

      if (sentChannels.length === 0) {
        // Roll the claim back so the batch retries on the next run.
        await admin
          .from("deferred_work")
          .update({
            book_token_hash: null,
            followup_count: batch.stage - 1,
            last_followup_at: batch.records[0].last_followup_at,
            updated_at: nowIso,
          })
          .in("id", recordIds);
        results.failed++;
        results.errors.push(`send ${customer.id}: no channel succeeded`);
        continue;
      }

      await logAudit({
        organizationId: org.id,
        action: "deferred.followup_sent",
        entityType: "deferred_work",
        entityId: batch.records[0].id,
        metadata: {
          customer_id: customer.id,
          vehicle_id: batch.vehicleId,
          stage: batch.stage,
          records: recordIds.length,
          channels: sentChannels,
        },
      });
      results.sent++;
    }
  }

  results.held = await recordHeld(admin, held);

  console.log("[cron/deferred-followups]", results);
  await recordCronRun(
    admin,
    "cron/deferred-followups",
    results.failed === 0,
    Date.now() - __t0,
    `sent ${results.sent}, skipped ${results.skipped}, failed ${results.failed}`,
  );
  return NextResponse.json({ success: true, ...results });
}
