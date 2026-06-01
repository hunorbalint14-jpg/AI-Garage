import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeEqual } from "@/lib/safe-equal";
import { sendEmail } from "@/lib/email";
import { tenantPayUrl } from "@/lib/stripe";
import { logAudit } from "@/lib/audit";
import { dunningStage, daysOverdue, DEFAULT_DUNNING_CADENCE } from "@/lib/dunning";

// Overdue-invoice dunning. Dispatched per-location by /api/cron/tick when the
// `invoice_dunning` scheduled_task is due. For each unpaid, past-due invoice it
// emails an escalating reminder with a "Pay now" link, capped by the cadence.
// Paid invoices flip to status='paid' (Stripe webhook) and drop out of the
// query, so reminders stop automatically.
export const runtime = "nodejs";
export const maxDuration = 60;

type LocationRow = {
  id: string;
  slug: string;
  name: string;
  organization: { id: string; name: string } | null;
};

type InvoiceRow = {
  id: string;
  invoice_number: string;
  total: number;
  due_at: string;
  dunning_count: number;
  last_dunned_at: string | null;
  customer: { full_name: string | null; email: string | null } | null;
};

function fmtGBP(n: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function sameUtcDay(a: Date, b: Date): boolean {
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !safeEqual(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const filterLocationId = searchParams.get("location_id");

  const admin = createAdminClient();
  const now = new Date();
  const nowIso = now.toISOString();

  let locationsQuery = admin
    .from("locations")
    .select("id, slug, name, organization:organizations(id, name)");
  if (filterLocationId) locationsQuery = locationsQuery.eq("id", filterLocationId);
  const { data: locations } = (await locationsQuery) as { data: LocationRow[] | null };

  const results = { sent: 0, skipped: 0, failed: 0, errors: [] as string[] };

  for (const location of locations ?? []) {
    const garageName = location.organization?.name ?? location.name;

    // Per-location cadence override (Automations settings); default [1,7,14].
    const { data: task } = await admin
      .from("scheduled_tasks")
      .select("enabled, settings")
      .eq("location_id", location.id)
      .eq("task_type", "invoice_dunning")
      .maybeSingle();
    if (task && task.enabled === false) continue;
    const cadence =
      (task?.settings?.cadence_days as number[] | undefined)?.length
        ? (task!.settings!.cadence_days as number[])
        : [...DEFAULT_DUNNING_CADENCE];

    const { data: invoices } = (await admin
      .from("invoices")
      .select("id, invoice_number, total, due_at, dunning_count, last_dunned_at, customer:customers(full_name, email)")
      .eq("location_id", location.id)
      .eq("status", "sent")
      .is("paid_at", null)
      .lt("due_at", nowIso)
      .limit(200)) as { data: InvoiceRow[] | null };

    for (const inv of invoices ?? []) {
      const email = inv.customer?.email;
      if (!email) {
        results.skipped++;
        continue;
      }

      const overdue = daysOverdue(inv.due_at, now);
      const { send, stage } = dunningStage(overdue, inv.dunning_count ?? 0, cadence);
      if (!send) {
        results.skipped++;
        continue;
      }
      // Belt-and-suspenders against a same-day double fire.
      if (inv.last_dunned_at && sameUtcDay(new Date(inv.last_dunned_at), now)) {
        results.skipped++;
        continue;
      }

      const firstName = inv.customer?.full_name?.split(" ")[0] ?? "there";
      const isFinal = stage >= cadence.length;
      const subject = `${isFinal ? "Final reminder" : "Reminder"}: invoice ${inv.invoice_number} is overdue`;
      const text =
        `Hi ${firstName},\n\n` +
        `This is a ${isFinal ? "final " : ""}reminder that invoice ${inv.invoice_number} for ${fmtGBP(inv.total)} ` +
        `was due on ${fmtDate(inv.due_at)} and is now overdue.\n\n` +
        `You can pay securely online using the button below. If you've already paid, please ignore this message.\n\n` +
        `Thank you,\n${garageName}`;

      const res = await sendEmail({
        to: email,
        subject,
        text,
        cta: { url: tenantPayUrl(inv.id), label: "Pay now" },
      });

      if (res.success) {
        await admin
          .from("invoices")
          .update({ dunning_count: stage, last_dunned_at: nowIso })
          .eq("id", inv.id);
        await logAudit({
          organizationId: location.organization?.id ?? null,
          action: "invoice.dunning_sent",
          entityType: "invoice",
          entityId: inv.id,
          metadata: { stage, days_overdue: overdue, total: inv.total },
        });
        results.sent++;
      } else {
        results.failed++;
        results.errors.push(`${inv.invoice_number}: ${res.error}`);
      }
    }
  }

  console.log("[cron/dunning]", results);
  return NextResponse.json({ success: true, ...results });
}
