import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeEqual } from "@/lib/safe-equal";
import { sendEmail } from "@/lib/email";
import { tenantPayUrl } from "@/lib/stripe";
import { logAudit } from "@/lib/audit";
import { recordCronRun } from "@/lib/platform/cron-runs";
import { dunningStage, daysOverdue, DEFAULT_DUNNING_CADENCE } from "@/lib/dunning";
import { garageLabel, addressOneLine } from "@/lib/garage-identity";

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
  address: string | null;
  organization: { id: string; name: string } | null;
};

type InvoiceRow = {
  id: string;
  invoice_number: string;
  total: number;
  amount_paid: number | null;
  due_at: string;
  dunning_count: number;
  last_dunned_at: string | null;
  customer_id: string | null;
  customer: { full_name: string | null; email: string | null; account_customer: boolean | null } | null;
};

const outstandingOf = (inv: InvoiceRow) =>
  Math.round((Number(inv.total) - Number(inv.amount_paid ?? 0)) * 100) / 100;

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
    .select("id, slug, name, address, organization:organizations!organization_id(id, name)");
  if (filterLocationId) locationsQuery = locationsQuery.eq("id", filterLocationId);
  const { data: locations } = (await locationsQuery) as { data: LocationRow[] | null };

  const __t0 = Date.now();
  const results = { sent: 0, skipped: 0, failed: 0, errors: [] as string[] };

  for (const location of locations ?? []) {
    const orgName = location.organization?.name ?? location.name;
    // Identify the issuing branch (+ address) on the reminder, not just the org.
    const garageName = garageLabel({ orgName, locationName: location.name });
    const addrLine = addressOneLine(location.address);
    const locationFooter = addrLine ? `\n\n📍 ${addrLine}` : "";

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
      .select("id, invoice_number, total, amount_paid, due_at, dunning_count, last_dunned_at, customer_id, customer:customers(full_name, email, account_customer)")
      .eq("location_id", location.id)
      .eq("status", "sent")
      .is("paid_at", null)
      .lt("due_at", nowIso)
      .limit(200)) as unknown as { data: InvoiceRow[] | null };

    // Account customers (#504) get ONE reminder covering every overdue
    // invoice — a trade account with five open invoices is one conversation,
    // not five nags. Everyone else keeps the per-invoice flow.
    const perInvoice: InvoiceRow[] = [];
    const accountGroups = new Map<string, InvoiceRow[]>();
    for (const inv of invoices ?? []) {
      if (inv.customer?.account_customer && inv.customer_id) {
        accountGroups.set(inv.customer_id, [...(accountGroups.get(inv.customer_id) ?? []), inv]);
      } else {
        perInvoice.push(inv);
      }
    }

    for (const [, group] of accountGroups) {
      const email = group[0].customer?.email;
      if (!email) {
        results.skipped++;
        continue;
      }
      // Stage/cadence keyed to the OLDEST overdue invoice; one send bumps
      // every member so the group stays in step.
      const oldest = group.reduce((a, b) => (a.due_at < b.due_at ? a : b));
      const overdue = daysOverdue(oldest.due_at, now);
      const { send, stage } = dunningStage(overdue, oldest.dunning_count ?? 0, cadence);
      if (!send || (oldest.last_dunned_at && sameUtcDay(new Date(oldest.last_dunned_at), now))) {
        results.skipped++;
        continue;
      }

      const totalOutstanding = Math.round(group.reduce((s, i) => s + outstandingOf(i), 0) * 100) / 100;
      const firstName = group[0].customer?.full_name?.split(" ")[0] ?? "there";
      const isFinal = stage >= cadence.length;
      const lines = group
        .map((i) => `• ${i.invoice_number} — ${fmtGBP(outstandingOf(i))} (due ${fmtDate(i.due_at)})`)
        .join("\n");
      const res = await sendEmail({
        to: email,
        subject: `${isFinal ? "Final reminder" : "Reminder"}: ${fmtGBP(totalOutstanding)} outstanding on your account`,
        text:
          `Hi ${firstName},\n\n` +
          `A ${isFinal ? "final " : ""}reminder that the following invoice${group.length === 1 ? " is" : "s are"} overdue on your account:\n\n${lines}\n\n` +
          `Total outstanding: ${fmtGBP(totalOutstanding)}. If you've already paid, please ignore this message.\n\n` +
          `Thank you,\n${garageName}${locationFooter}`,
      });
      if (res.success) {
        await admin
          .from("invoices")
          .update({ dunning_count: stage, last_dunned_at: nowIso })
          .in("id", group.map((i) => i.id));
        await logAudit({
          organizationId: location.organization?.id ?? null,
          action: "invoice.dunning_sent",
          entityType: "invoice",
          entityId: oldest.id,
          metadata: { stage, days_overdue: overdue, total: totalOutstanding, account_group: group.length },
        });
        results.sent++;
      } else {
        results.failed++;
        results.errors.push(`account ${group[0].invoice_number}: ${res.error}`);
      }
    }

    for (const inv of perInvoice) {
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
        `This is a ${isFinal ? "final " : ""}reminder that invoice ${inv.invoice_number} for ${fmtGBP(outstandingOf(inv))} ` +
        `was due on ${fmtDate(inv.due_at)} and is now overdue.\n\n` +
        `You can pay securely online using the button below. If you've already paid, please ignore this message.\n\n` +
        `Thank you,\n${garageName}${locationFooter}`;

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
  await recordCronRun(admin, "cron/dunning", results.failed === 0, Date.now() - __t0, `sent ${results.sent}, failed ${results.failed}`);
  return NextResponse.json({ success: true, ...results });
}
