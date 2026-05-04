import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";
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

const REMIND_DAYS_BEFORE = 30;
const DEDUP_DAYS = 30;

type VehicleRow = {
  id: string;
  registration: string;
  make: string | null;
  model: string | null;
  year: number | null;
  mot_expiry: string | null;
  service_due: string | null;
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

    const { data: vehicles } = (await admin
      .from("vehicles")
      .select("id, registration, make, model, year, mot_expiry, service_due, customer:customers(id, full_name, email, phone)")
      .eq("location_id", location.id)
      .or(`mot_expiry.lte.${windowEndStr},service_due.lte.${windowEndStr}`)
      .gt("mot_expiry", todayStr)
      .limit(100)) as { data: VehicleRow[] | null };

    for (const vehicle of vehicles ?? []) {
      const customer = vehicle.customer;
      if (!customer) continue;

      for (const reminderType of ["mot", "service"] as const) {
        const dueDate = reminderType === "mot" ? vehicle.mot_expiry : vehicle.service_due;
        if (!dueDate) continue;

        const daysUntilDue = Math.ceil(
          (new Date(dueDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );
        if (daysUntilDue < 0 || daysUntilDue > REMIND_DAYS_BEFORE) continue;

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
        if (customer.email) {
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

        // SMS channel
        if (customer.phone) {
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

  console.log("[cron/reminders]", results);
  return NextResponse.json({ success: true, ...results });
}
