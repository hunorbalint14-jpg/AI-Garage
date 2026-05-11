import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
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
  name: string;
  organization: {
    id: string;
    name: string;
    phone: string | null;
  } | null;
};

async function wasRecentlySent(
  admin: ReturnType<typeof createAdminClient>,
  vehicleId: string,
  reminderType: string,
  channel: string,
  dedupCutoff: Date,
): Promise<boolean> {
  const { data } = await admin
    .from("reminders")
    .select("id")
    .eq("vehicle_id", vehicleId)
    .eq("type", reminderType)
    .eq("channel", channel)
    .eq("status", "sent")
    .gte("sent_at", dedupCutoff.toISOString())
    .maybeSingle();
  return !!data;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const now = new Date();
  const windowEnd = new Date(now);
  windowEnd.setDate(windowEnd.getDate() + REMIND_DAYS_BEFORE);
  const dedupCutoff = new Date(now);
  dedupCutoff.setDate(dedupCutoff.getDate() - DEDUP_DAYS);

  const windowEndStr = windowEnd.toISOString().split("T")[0];
  const todayStr = now.toISOString().split("T")[0];

  const { data: locations } = (await admin
    .from("locations")
    .select("id, name, organization:organizations(id, name, phone)")) as {
    data: LocationRow[] | null;
  };

  const results = { sent: 0, skipped: 0, failed: 0, errors: [] as string[] };

  for (const location of locations ?? []) {
    const org = location.organization;

    const [motConfig, serviceConfig, taxConfig] = await Promise.all([
      getTaskConfig(admin, location.id, "mot_reminders"),
      getTaskConfig(admin, location.id, "service_reminders"),
      getTaskConfig(admin, location.id, "tax_reminders"),
    ]);

    const motEnabled = motConfig.enabled;
    const serviceEnabled = serviceConfig.enabled;
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

    for (const vehicle of vehicles ?? []) {
      const customer = vehicle.customer;
      if (!customer) continue;

      for (const reminderType of ["mot", "service"] as const) {
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

        // Email channel
        if (customer.email && allowedChannels.includes("email")) {
          const alreadySent = await wasRecentlySent(admin, vehicle.id, reminderType, "email", dedupCutoff);
          if (alreadySent) {
            results.skipped++;
          } else {
            let messageText: string;
            try {
              messageText = await draftReminderMessage(draftInput);
            } catch {
              messageText = fallbackReminderMessage(draftInput);
            }

            const emailResult = await sendEmail({ to: customer.email, subject, text: messageText });

            await admin.from("reminders").insert({
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
        }

        // WhatsApp channel
        if (customer.phone && allowedChannels.includes("whatsapp")) {
          const alreadySent = await wasRecentlySent(admin, vehicle.id, reminderType, "whatsapp", dedupCutoff);
          if (alreadySent) {
            results.skipped++;
          } else {
            let waText: string;
            try {
              waText = await draftSmsReminderMessage(draftInput);
            } catch {
              waText = fallbackSmsReminderMessage(draftInput);
            }

            const waResult = await sendWhatsApp({ to: customer.phone, body: waText });

            await admin.from("reminders").insert({
              location_id: location.id,
              customer_id: customer.id,
              vehicle_id: vehicle.id,
              type: reminderType,
              channel: "whatsapp",
              recipient_email: null,
              recipient_phone: customer.phone,
              subject,
              message_text: waText,
              status: waResult.success ? "sent" : "failed",
              error_message: waResult.success ? null : waResult.error,
            });

            if (waResult.success) results.sent++;
            else {
              results.failed++;
              results.errors.push(`${vehicle.registration} (${reminderType}/whatsapp): ${waResult.error}`);
            }
          }
        }

        // SMS channel
        if (customer.phone && allowedChannels.includes("sms")) {
          const alreadySent = await wasRecentlySent(admin, vehicle.id, reminderType, "sms", dedupCutoff);
          if (alreadySent) {
            results.skipped++;
          } else {
            let smsText: string;
            try {
              smsText = await draftSmsReminderMessage(draftInput);
            } catch {
              smsText = fallbackSmsReminderMessage(draftInput);
            }

            const smsResult = await sendSms({ to: customer.phone, body: smsText });

            await admin.from("reminders").insert({
              location_id: location.id,
              customer_id: customer.id,
              vehicle_id: vehicle.id,
              type: reminderType,
              channel: "sms",
              recipient_email: null,
              recipient_phone: customer.phone,
              subject,
              message_text: smsText,
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
      }
    }
  }

  // VED (road tax) reminders — simple template, no AI draft needed
  for (const location of locations ?? []) {
    const org = location.organization;
    const taxConfig = await getTaskConfig(admin, location.id, "tax_reminders");
    if (!taxConfig.enabled) continue;
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

    for (const v of vedVehicles ?? []) {
      const customer = v.customer;
      if (!customer) continue;

      const daysUntil = Math.ceil((new Date(v.tax_due_date).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (daysUntil < 0 || daysUntil > taxDays) continue;

      const firstName = customer.full_name?.split(" ")[0] ?? "there";
      const garageName = org?.name ?? location.name;
      const formattedDate = new Date(v.tax_due_date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
      const subject = `Road tax reminder — ${v.registration} due ${formattedDate}`;
      const body = `Hi ${firstName},\n\nThis is a friendly reminder that the road tax for your vehicle ${v.registration} is due on ${formattedDate}.\n\nYou can renew online at gov.uk/renew-vehicle-tax or at your local Post Office.\n\nThank you,\n${garageName}`;

      if (customer.email && taxChannels.includes("email")) {
        const alreadySent = await wasRecentlySent(admin, v.id, "tax", "email", dedupCutoff);
        if (!alreadySent) {
          const emailResult = await sendEmail({ to: customer.email, subject, text: body });
          await admin.from("reminders").insert({ location_id: location.id, customer_id: customer.id, vehicle_id: v.id, type: "tax", channel: "email", recipient_email: customer.email, recipient_phone: null, subject, message_text: body, status: emailResult.success ? "sent" : "failed", error_message: emailResult.success ? null : emailResult.error });
          emailResult.success ? results.sent++ : results.failed++;
        }
      }
      if (customer.phone && taxChannels.includes("sms")) {
        const smsBody = `Hi ${firstName}, your road tax for ${v.registration} is due ${formattedDate}. Renew at gov.uk/renew-vehicle-tax.`;
        const alreadySent = await wasRecentlySent(admin, v.id, "tax", "sms", dedupCutoff);
        if (!alreadySent) {
          const smsResult = await sendSms({ to: customer.phone, body: smsBody });
          await admin.from("reminders").insert({ location_id: location.id, customer_id: customer.id, vehicle_id: v.id, type: "tax", channel: "sms", recipient_email: null, recipient_phone: customer.phone, subject, message_text: smsBody, status: smsResult.success ? "sent" : "failed", error_message: smsResult.success ? null : smsResult.error });
          smsResult.success ? results.sent++ : results.failed++;
        }
      }
    }
  }

  console.log("[cron/reminders]", results);
  return NextResponse.json({ success: true, ...results });
}
