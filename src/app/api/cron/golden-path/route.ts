import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeEqual } from "@/lib/safe-equal";
import { evaluateAlerts } from "@/lib/platform/alerts";
import { recordCronRun } from "@/lib/platform/cron-runs";
import { buildInvoiceHtml } from "@/lib/invoice-html";

export const runtime = "nodejs";
export const maxDuration = 60;

// Golden-path synthetic check (#452): today we find out something is broken
// when the garage calls. This cron exercises the critical write + render path
// against a CANARY tenant on a schedule, so a break pages us first:
//
//   1. canary lookup   — org + branch resolve (read path)
//   2. booking create  — real insert into bookings, read back, then deleted
//   3. invoice render  — buildInvoiceHtml over synthetic args
//
// Each step lands in uptime_checks as target_kind "endpoint" with a
// "golden:*" key and organization_id NULL — visible to the alert rules and
// the admin dashboard WITHOUT polluting any tenant's own uptime metrics.
// A step is also failed when it exceeds the latency budget.
//
// Config: CANARY_ORG_SLUG names the canary tenant (unset → the check no-ops,
// so local/preview environments stay quiet); GOLDEN_PATH_BUDGET_MS overrides
// the per-step budget (default 5000ms).

const BUDGET_MS = Number(process.env.GOLDEN_PATH_BUDGET_MS ?? 5000);
const SYNTHETIC_NOTE = "[synthetic golden-path check — auto-deleted]";

type Sample = {
  target_kind: "tenant" | "service" | "endpoint";
  target_key: string;
  organization_id: string | null;
  ok: boolean;
  status_code: number | null;
  latency_ms: number | null;
  error: string | null;
};

async function step(key: string, fn: () => Promise<void>): Promise<Sample> {
  const started = performance.now();
  try {
    await fn();
    const ms = Math.round(performance.now() - started);
    const overBudget = ms > BUDGET_MS;
    return {
      target_kind: "endpoint",
      target_key: `golden:${key}`,
      organization_id: null,
      ok: !overBudget,
      status_code: null,
      latency_ms: ms,
      error: overBudget ? `latency ${ms}ms over budget ${BUDGET_MS}ms` : null,
    };
  } catch (e) {
    return {
      target_kind: "endpoint",
      target_key: `golden:${key}`,
      organization_id: null,
      ok: false,
      status_code: null,
      latency_ms: Math.round(performance.now() - started),
      error: (e as Error).message.slice(0, 300),
    };
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !safeEqual(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const __t0 = Date.now();

  const canarySlug = process.env.CANARY_ORG_SLUG;
  if (!canarySlug) {
    await recordCronRun(admin, "cron/golden-path", true, Date.now() - __t0, "skipped: CANARY_ORG_SLUG unset");
    return NextResponse.json({ success: true, skipped: "CANARY_ORG_SLUG unset" });
  }

  let locationId: string | null = null;
  let bookingId: string | null = null;
  const samples: Sample[] = [];

  // 1 — canary lookup (org + first branch).
  samples.push(
    await step("canary-lookup", async () => {
      const { data: org, error } = await admin
        .from("organizations")
        .select("id, locations:locations!organization_id(id)")
        .eq("slug", canarySlug)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const row = org as { id: string; locations: { id: string }[] } | null;
      if (!row || row.locations.length === 0) throw new Error(`canary org '${canarySlug}' or its branch missing`);
      locationId = row.locations[0].id;
    }),
  );

  // 2 — booking create: a real insert + read-back on the canary branch.
  if (locationId) {
    samples.push(
      await step("booking-create", async () => {
        const scheduled = new Date(Date.now() + 26 * 60 * 60_000); // tomorrow-ish, off peak
        const { data, error } = await admin
          .from("bookings")
          .insert({
            location_id: locationId!,
            scheduled_at: scheduled.toISOString(),
            duration_minutes: 30,
            type: "service",
            status: "cancelled", // never occupies a bay or shows as work
            notes: SYNTHETIC_NOTE,
          })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        bookingId = (data as { id: string }).id;
        const { data: readBack, error: readErr } = await admin
          .from("bookings")
          .select("id")
          .eq("id", bookingId)
          .maybeSingle();
        if (readErr) throw new Error(readErr.message);
        if (!readBack) throw new Error("read-back missed the inserted booking");
      }),
    );
  }

  // 3 — invoice render over synthetic args (the template path invoices use).
  samples.push(
    await step("invoice-render", async () => {
      const html = buildInvoiceHtml({
        invoiceNumber: "SYN-0000",
        issuedAt: new Date().toISOString(),
        dueAt: new Date().toISOString(),
        garageName: "Canary Garage",
        locationName: "Canary Garage",
        garageAddress: "1 Synthetic Way",
        garagePhone: null,
        garageEmail: null,
        logoUrl: null,
        brandColor: "#1f2937",
        customerName: "Synthetic Customer",
        items: [{ description: "Golden-path check", quantity: 1, unit_price: 1, type: "labour" }],
        subtotal: 1,
        vatRate: 20,
        vatAmount: 0.2,
        total: 1.2,
        discountAmount: 0,
        discountDescription: null,
        membershipCreditAmount: 0,
        membershipCreditDescription: null,
        notes: null,
        payUrl: null,
      });
      if (!html || html.length < 1000 || !html.includes("SYN-0000")) {
        throw new Error("invoice HTML rendered incomplete");
      }
    }),
  );

  // Cleanup — the synthetic booking never outlives the run.
  if (bookingId) {
    samples.push(
      await step("cleanup", async () => {
        const { error } = await admin.from("bookings").delete().eq("id", bookingId!).eq("notes", SYNTHETIC_NOTE);
        if (error) throw new Error(error.message);
      }),
    );
  }

  const { error: insErr } = await admin.from("uptime_checks").insert(samples);
  if (insErr) console.error("[cron/golden-path] insert failed", insErr.message);

  // Same alert machinery as the uptime probe → Slack + auto-incidents.
  const declared = await evaluateAlerts(admin, samples);

  const failed = samples.filter((s) => !s.ok);
  const summary = failed.length
    ? `FAILED: ${failed.map((f) => `${f.target_key} (${f.error})`).join("; ")}`
    : `ok: ${samples.map((s) => `${s.target_key.replace("golden:", "")} ${s.latency_ms}ms`).join(", ")}`;
  await recordCronRun(admin, "cron/golden-path", failed.length === 0, Date.now() - __t0, summary.slice(0, 300));
  console.log("[cron/golden-path]", { steps: samples.length, failed: failed.length, declared });

  return NextResponse.json({
    success: failed.length === 0,
    steps: samples.map((s) => ({ key: s.target_key, ok: s.ok, ms: s.latency_ms, error: s.error })),
    declared,
  });
}
