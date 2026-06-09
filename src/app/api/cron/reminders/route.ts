import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeEqual } from "@/lib/safe-equal";
import { recordCronRun } from "@/lib/platform/cron-runs";
import { sendEmail, tenantBookingUrl } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import { sendWhatsApp } from "@/lib/whatsapp";
import {
  draftReminderMessage,
  draftSmsReminderMessage,
  fallbackReminderMessage,
  fallbackSmsReminderMessage,
} from "@/lib/ai-messages";

// Runs daily at 09:00 UTC via Vercel Cron (configured in vercel.json).
// Finds all vehicles with MOT or service due within REMIND_DAYS_BEFORE days,
// skips channels that already sent the same reminder type within DEDUP_DAYS,
// then drafts a personalised Claude message and sends via email + SMS.
export const runtime = "nodejs";
export const maxDuration = 60;

const REMIND_DAYS_BEFORE_DEFAULT = 30;
const DEDUP_DAYS = 30;
// Vehicles processed in parallel per location. Each vehicle can cost an AI
// draft plus up to three channel sends, so stay modest — enough to fit a busy
// location inside maxDuration without hammering Resend/Twilio/Anthropic.
const VEHICLE_CONCURRENCY = 5;

type TaskRow = { enabled: boolean; settings: Record<string, unknown> };

async function getTaskConfig(
  admin: ReturnType<typeof createAdminClient>,
  locationId: string,
  taskType: string,
): Promise<TaskRow> {
  const { data } = await admin
    .from("scheduled_tasks")
    .select("enabled, settings")
    .eq("location_id", locationId)
    .eq("task_type", taskType)
    .maybeSingle();
  return data ?? { enabled: true, settings: {} };
}

type VehicleRow = {
  id: string;
  registration: string;
  make: string | null;
  model: string | null;
  year: number | null;
  mot_expiry: string | null;
  service_due: string | null;
  tax_due_date: string | null;
  customer: {
    id: string;
    full_name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
};

type LocationRow = {
  id: string;
  slug: string;
  name: string;
  organization: {
    id: string;
    name: string;
    phone: string | null;
  } | null;
};

// One dedup query per location instead of one per vehicle × type × channel.
// Returns the set of "vehicleId:type:channel" combos already sent since the
// cutoff. (The old per-row .maybeSingle() lookup also broke once a vehicle had
// two sent rows for the same combo — multiple rows → error → null data →
// treated as "not sent" → re-send. A set over all rows has no such failure
// mode.)
async function fetchSentSet(
  admin: ReturnType<typeof createAdminClient>,
  vehicleIds: string[],
  dedupCutoff: Date,
): Promise<Set<string>> {
  if (vehicleIds.length === 0) return new Set();
  const { data } = await admin
    .from("reminders")
    .select("vehicle_id, type, channel")
    .in("vehicle_id", vehicleIds)
    .eq("status", "sent")
    .gte("sent_at", dedupCutoff.toISOString());
  return new Set((data ?? []).map((r) => `${r.vehicle_id}:${r.type}:${r.channel}`));
}

// Insert a reminders row and make a failure loud. A silently failed insert is
// worse than a failed send: the next run can't see the reminder went out and
// re-sends it (this is exactly what happened before the
// 20260609160000_reminders_channels_fix migration widened the check
// constraints).
async function insertReminder(
  admin: ReturnType<typeof createAdminClient>,
  row: Record<string, unknown>,
): Promise<void> {
  const { error } = await admin.from("reminders").insert(row);
  if (error) {
    console.error("[cron/reminders] insert failed", {
      vehicle_id: row.vehicle_id,
      type: row.type,
      channel: row.channel,
      error: error.message,
    });
  }
}

// Minimal worker pool: run fn over items with at most `limit` in flight.
// fn must not throw — callers wrap their body in try/catch and record failures.
async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i]);
      }
    }),
  );
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !safeEqual(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const filterLocationId = searchParams.get("location_id");
  const filterTaskType = searchParams.get("task_type");

  const admin = createAdminClient();

  const now = new Date();
  const dedupCutoff = new Date(now);
  dedupCutoff.setDate(dedupCutoff.getDate() - DEDUP_DAYS);
  const todayStr = now.toISOString().split("T")[0];

  const wantMotService =
    !filterTaskType || filterTaskType === "mot_reminders" || filterTaskType === "service_reminders";
  const wantTax = !filterTaskType || filterTaskType === "tax_reminders";

  let locationsQuery = admin
    .from("locations")
    .select("id, slug, name, organization:organizations(id, name, phone)");
  if (filterLocationId) locationsQuery = locationsQuery.eq("id", filterLocationId);

  const { data: locations } = (await locationsQuery) as { data: LocationRow[] | null };

  const __t0 = Date.now();
  const results = { sent: 0, skipped: 0, failed: 0, errors: [] as string[] };

  for (const location of locations ?? []) {
    const org = location.organization;
    const bookingUrl = tenantBookingUrl(location.slug);
    const bookingCta = { url: bookingUrl, label: "Book your appointment" };
    const smsWithLink = (body: string) => `${body}\nBook: ${bookingUrl}`;

    // Fetched once per location and shared by the MOT/service AND tax passes
    // below (the tax pass used to refetch its config in a second loop).
    const [motConfig, serviceConfig, taxConfig] = await Promise.all([
      getTaskConfig(admin, location.id, "mot_reminders"),
      getTaskConfig(admin, location.id, "service_reminders"),
      getTaskConfig(admin, location.id, "tax_reminders"),
    ]);

    // ---- MOT + service reminders (AI-drafted) ----
    const motEnabled = motConfig.enabled;
    const serviceEnabled = serviceConfig.enabled;
    if (wantMotService && (motEnabled || serviceEnabled)) {
      const motDays = (motConfig.settings.remind_days_before as number) ?? REMIND_DAYS_BEFORE_DEFAULT;
      const serviceDays = (serviceConfig.settings.remind_days_before as number) ?? REMIND_DAYS_BEFORE_DEFAULT;
      const motChannels = (motConfig.settings.channels as string[]) ?? ["email", "sms", "whatsapp"];
      const serviceChannels = (serviceConfig.settings.channels as string[]) ?? ["email", "sms", "whatsapp"];

      const maxDays = Math.max(
        motEnabled ? motDays : 0,
        serviceEnabled ? serviceDays : 0,
      );
      const windowEndDyn = new Date(now);
      windowEndDyn.setDate(windowEndDyn.getDate() + maxDays);
      const windowEndDynStr = windowEndDyn.toISOString().split("T")[0];

      const { data: vehicles } = (await admin
        .from("vehicles")
        .select("id, registration, make, model, year, mot_expiry, service_due, tax_due_date, customer:customers(id, full_name, email, phone)")
        .eq("location_id", location.id)
        .or(`mot_expiry.lte.${windowEndDynStr},service_due.lte.${windowEndDynStr}`)
        .gt("mot_expiry", todayStr)
        .limit(100)) as { data: VehicleRow[] | null };

      const vehicleRows = vehicles ?? [];
      const sentSet = await fetchSentSet(admin, vehicleRows.map((v) => v.id), dedupCutoff);

      await mapPool(vehicleRows, VEHICLE_CONCURRENCY, async (vehicle) => {
        const customer = vehicle.customer;
        if (!customer) return;

        for (const reminderType of ["mot", "service"] as const) {
          const taskTypeName = reminderType === "mot" ? "mot_reminders" : "service_reminders";
          if (filterTaskType && filterTaskType !== taskTypeName) continue;
          const taskEnabled = reminderType === "mot" ? motEnabled : serviceEnabled;
          if (!taskEnabled) continue;
          const remindDays = reminderType === "mot" ? motDays : serviceDays;
          const allowedChannels = reminderType === "mot" ? motChannels : serviceChannels;
          const dueDate = reminderType === "mot" ? vehicle.mot_expiry : vehicle.service_due;
          if (!dueDate) continue;

          const daysUntilDue = Math.ceil(
            (new Date(dueDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
          );
          if (daysUntilDue < 0 || daysUntilDue > remindDays) continue;

          const firstName = customer.full_name?.split(" ")[0] ?? "there";
          const vehicleDescription = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ");
          const formattedDate = new Date(dueDate).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "long",
            year: "numeric",
          });
          const label = reminderType === "mot" ? "MOT" : "service";
          const subject = `${label.toUpperCase()} reminder — ${vehicle.registration} due ${formattedDate}`;

          const draftInput = {
            garageName: org?.name ?? location.name,
            garagePhone: org?.phone ?? null,
            customerFirstName: firstName,
            registration: vehicle.registration,
            vehicleDescription: vehicleDescription || vehicle.registration,
            reminderType,
            dueDate: formattedDate,
          };
          // Automated (cron) AI drafts — attributed to the location; the overview
          // view derives the org from location_id. No user (system-run).
          const aiCtx = { locationId: location.id, feature: "reminder_auto" };

          const alreadySent = (channel: string) => sentSet.has(`${vehicle.id}:${reminderType}:${channel}`);

          const wantEmail = !!customer.email && allowedChannels.includes("email");
          const wantWhatsApp = !!customer.phone && allowedChannels.includes("whatsapp");
          const wantSms = !!customer.phone && allowedChannels.includes("sms");

          const needEmail = wantEmail && !alreadySent("email");
          const needWhatsApp = wantWhatsApp && !alreadySent("whatsapp");
          const needSms = wantSms && !alreadySent("sms");
          if (wantEmail && !needEmail) results.skipped++;
          if (wantWhatsApp && !needWhatsApp) results.skipped++;
          if (wantSms && !needSms) results.skipped++;

          // One short draft shared by WhatsApp AND SMS — both channels send the
          // same text, so drafting per channel was two identical Claude calls.
          let shortText: string | null = null;
          if (needWhatsApp || needSms) {
            try {
              shortText = await draftSmsReminderMessage(draftInput, aiCtx);
            } catch {
              shortText = fallbackSmsReminderMessage(draftInput);
            }
          }

          // Email channel
          if (needEmail && customer.email) {
            let messageText: string;
            try {
              messageText = await draftReminderMessage(draftInput, aiCtx);
            } catch {
              messageText = fallbackReminderMessage(draftInput);
            }

            const emailResult = await sendEmail({ to: customer.email, subject, text: messageText, cta: bookingCta });

            await insertReminder(admin, {
              location_id: location.id,
              customer_id: customer.id,
              vehicle_id: vehicle.id,
              type: reminderType,
              channel: "email",
              recipient_email: customer.email,
              recipient_phone: null,
              subject,
              message_text: messageText,
              status: emailResult.success ? "sent" : "failed",
              error_message: emailResult.success ? null : emailResult.error,
              resend_email_id: emailResult.success ? emailResult.messageId : null,
            });

            if (emailResult.success) {
              results.sent++;
            } else {
              results.failed++;
              results.errors.push(`${vehicle.registration} (${reminderType}/email): ${emailResult.error}`);
            }
          }

          // WhatsApp channel
          if (needWhatsApp && customer.phone && shortText !== null) {
            const waResult = await sendWhatsApp({ to: customer.phone, body: smsWithLink(shortText) });

            await insertReminder(admin, {
              location_id: location.id,
              customer_id: customer.id,
              vehicle_id: vehicle.id,
              type: reminderType,
              channel: "whatsapp",
              recipient_email: null,
              recipient_phone: customer.phone,
              subject,
              message_text: shortText,
              status: waResult.success ? "sent" : "failed",
              error_message: waResult.success ? null : waResult.error,
            });

            if (waResult.success) results.sent++;
            else {
              results.failed++;
              results.errors.push(`${vehicle.registration} (${reminderType}/whatsapp): ${waResult.error}`);
            }
          }

          // SMS channel
          if (needSms && customer.phone && shortText !== null) {
            const smsResult = await sendSms({ to: customer.phone, body: smsWithLink(shortText) });

            await insertReminder(admin, {
              location_id: location.id,
              customer_id: customer.id,
              vehicle_id: vehicle.id,
              type: reminderType,
              channel: "sms",
              recipient_email: null,
              recipient_phone: customer.phone,
              subject,
              message_text: shortText,
              status: smsResult.success ? "sent" : "failed",
              error_message: smsResult.success ? null : smsResult.error,
            });

            if (smsResult.success) {
              results.sent++;
            } else {
              results.failed++;
              results.errors.push(`${vehicle.registration} (${reminderType}/sms): ${smsResult.error}`);
            }
          }
        }
      });
    }

    // ---- VED (road tax) reminders — simple template, no AI draft needed ----
    if (wantTax && taxConfig.enabled) {
      const taxDays = (taxConfig.settings.remind_days_before as number) ?? REMIND_DAYS_BEFORE_DEFAULT;
      const taxChannels = (taxConfig.settings.channels as string[]) ?? ["email", "sms"];
      const taxWindowEnd = new Date(now);
      taxWindowEnd.setDate(taxWindowEnd.getDate() + taxDays);
      const taxWindowEndStr = taxWindowEnd.toISOString().split("T")[0];

      const { data: vedVehicles } = (await admin
        .from("vehicles")
        .select("id, registration, tax_due_date, customer:customers(id, full_name, email, phone)")
        .eq("location_id", location.id)
        .not("tax_due_date", "is", null)
        .lte("tax_due_date", taxWindowEndStr)
        .gte("tax_due_date", todayStr)
        .limit(100)) as { data: { id: string; registration: string; tax_due_date: string; customer: { id: string; full_name: string | null; email: string | null; phone: string | null } | null }[] | null };

      const vedRows = vedVehicles ?? [];
      const taxSentSet = await fetchSentSet(admin, vedRows.map((v) => v.id), dedupCutoff);

      await mapPool(vedRows, VEHICLE_CONCURRENCY, async (v) => {
        const customer = v.customer;
        if (!customer) return;

        const daysUntil = Math.ceil((new Date(v.tax_due_date).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (daysUntil < 0 || daysUntil > taxDays) return;

        const firstName = customer.full_name?.split(" ")[0] ?? "there";
        const garageName = org?.name ?? location.name;
        const formattedDate = new Date(v.tax_due_date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
        const subject = `Road tax reminder — ${v.registration} due ${formattedDate}`;
        const body = `Hi ${firstName},\n\nThis is a friendly reminder that the road tax for your vehicle ${v.registration} is due on ${formattedDate}.\n\nYou can renew online at gov.uk/renew-vehicle-tax or at your local Post Office.\n\nThank you,\n${garageName}`;

        if (customer.email && taxChannels.includes("email")) {
          if (!taxSentSet.has(`${v.id}:tax:email`)) {
            const emailResult = await sendEmail({ to: customer.email, subject, text: body, cta: bookingCta });
            await insertReminder(admin, { location_id: location.id, customer_id: customer.id, vehicle_id: v.id, type: "tax", channel: "email", recipient_email: customer.email, recipient_phone: null, subject, message_text: body, status: emailResult.success ? "sent" : "failed", error_message: emailResult.success ? null : emailResult.error });
            emailResult.success ? results.sent++ : results.failed++;
          }
        }
        if (customer.phone && taxChannels.includes("sms")) {
          const smsBody = `Hi ${firstName}, your road tax for ${v.registration} is due ${formattedDate}. Renew at gov.uk/renew-vehicle-tax.\nGarage: ${bookingUrl}`;
          if (!taxSentSet.has(`${v.id}:tax:sms`)) {
            const smsResult = await sendSms({ to: customer.phone, body: smsBody });
            await insertReminder(admin, { location_id: location.id, customer_id: customer.id, vehicle_id: v.id, type: "tax", channel: "sms", recipient_email: null, recipient_phone: customer.phone, subject, message_text: smsBody, status: smsResult.success ? "sent" : "failed", error_message: smsResult.success ? null : smsResult.error });
            smsResult.success ? results.sent++ : results.failed++;
          }
        }
      });
    }
  }

  console.log("[cron/reminders]", results);
  await recordCronRun(admin, "cron/reminders", results.failed === 0, Date.now() - __t0, `sent ${results.sent}, failed ${results.failed}`);
  return NextResponse.json({ success: true, ...results });
}
