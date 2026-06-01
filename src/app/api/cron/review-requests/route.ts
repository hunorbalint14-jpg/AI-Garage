import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeEqual } from "@/lib/safe-equal";
import { sendEmail } from "@/lib/email";
import { logAudit } from "@/lib/audit";
import { generateReviewToken, hashReviewToken, tenantReviewUrl } from "@/lib/review-links";

// Sends queued post-job review requests. Dispatched per-location by
// /api/cron/tick when the `review_requests` scheduled_task is due (daily ~09:00
// → "next morning" after the job completes). Mints a fresh token at send time
// and stores only its hash, so the raw token is never persisted.
export const runtime = "nodejs";
export const maxDuration = 60;

type LocationRow = {
  id: string;
  slug: string;
  name: string;
  organization: { id: string; name: string } | null;
};

type QueuedRow = {
  id: string;
  customer: { full_name: string | null; email: string | null } | null;
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

  let locationsQuery = admin
    .from("locations")
    .select("id, slug, name, organization:organizations(id, name)");
  if (filterLocationId) locationsQuery = locationsQuery.eq("id", filterLocationId);
  const { data: locations } = (await locationsQuery) as { data: LocationRow[] | null };

  const results = { sent: 0, skipped: 0, failed: 0, errors: [] as string[] };

  for (const location of locations ?? []) {
    const { data: task } = await admin
      .from("scheduled_tasks")
      .select("enabled")
      .eq("location_id", location.id)
      .eq("task_type", "review_requests")
      .maybeSingle();
    if (task && task.enabled === false) continue;

    const garageName = location.organization?.name ?? location.name;

    const { data: queued } = (await admin
      .from("review_requests")
      .select("id, customer:customers(full_name, email)")
      .eq("location_id", location.id)
      .eq("status", "queued")
      .limit(200)) as { data: QueuedRow[] | null };

    for (const row of queued ?? []) {
      const email = row.customer?.email;
      if (!email) {
        await admin.from("review_requests").update({ status: "failed" }).eq("id", row.id);
        results.skipped++;
        continue;
      }

      const token = generateReviewToken();
      const firstName = row.customer?.full_name?.split(" ")[0] ?? "there";
      const subject = `How was your visit to ${garageName}?`;
      const text =
        `Hi ${firstName},\n\n` +
        `Thanks for choosing ${garageName}. We'd really appreciate a moment of your time to tell us how we did — it helps us keep improving.\n\n` +
        `Just tap the button below to leave your feedback.\n\n` +
        `Thank you,\n${garageName}`;

      const res = await sendEmail({
        to: email,
        subject,
        text,
        cta: { url: tenantReviewUrl(location.slug, token), label: "Leave feedback" },
      });

      if (res.success) {
        await admin
          .from("review_requests")
          .update({ status: "sent", sent_at: nowIso, token_hash: hashReviewToken(token) })
          .eq("id", row.id);
        await logAudit({
          organizationId: location.organization?.id ?? null,
          action: "review.requested",
          entityType: "review_request",
          entityId: row.id,
          metadata: {},
        });
        results.sent++;
      } else {
        await admin.from("review_requests").update({ status: "failed" }).eq("id", row.id);
        results.failed++;
        results.errors.push(`${row.id}: ${res.error}`);
      }
    }
  }

  console.log("[cron/review-requests]", results);
  return NextResponse.json({ success: true, ...results });
}
