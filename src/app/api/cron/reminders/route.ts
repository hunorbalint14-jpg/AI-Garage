import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { draftReminderMessage, fallbackReminderMessage } from "@/lib/ai-messages";

// Runs daily at 09:00 UTC via Vercel Cron (configured in vercel.json).
// Finds all vehicles with MOT or service due within REMIND_DAYS_BEFORE days,
// skips any that already received the same reminder type within 30 days,
// then drafts a personalised Claude email and sends via Resend.
export const runtime = "nodejs";
export const maxDuration = 60;

const REMIND_DAYS_BEFORE = 30;
const DEDUP_DAYS = 30; // don't re-send the same reminder type within this window

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
      .select(
        "id, registration, make, model, year, mot_expiry, service_due, customer:customers(id, full_name, email)",
      )
      .eq("location_id", location.id)
      .or(
        `mot_expiry.lte.${windowEndStr},service_due.lte.${windowEndStr}`,
      )
      .gt("mot_expiry", now.toISOString().split("T")[0])
      .limit(100)) as { data: VehicleRow[] | null };

    for (const vehicle of vehicles ?? []) {
      const customer = vehicle.customer;
      if (!customer?.email) continue;

      for (const reminderType of ["mot", "service"] as const) {
        const dueDate =
          reminderType === "mot" ? vehicle.mot_expiry : vehicle.service_due;
        if (!dueDate) continue;

        const daysUntilDue = Math.ceil(
          (new Date(dueDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );
        if (daysUntilDue < 0 || daysUntilDue > REMIND_DAYS_BEFORE) continue;

        // Skip if already reminded recently for this vehicle + type
        const { data: recentReminder } = await admin
          .from("reminders")
          .select("id")
          .eq("vehicle_id", vehicle.id)
          .eq("type", reminderType)
          .eq("status", "sent")
          .gte("sent_at", dedupCutoff.toISOString())
          .maybeSingle();

        if (recentReminder) {
          results.skipped++;
          continue;
        }

        const firstName = customer.full_name?.split(" ")[0] ?? "there";
        const vehicleDescription = [vehicle.year, vehicle.make, vehicle.model]
          .filter(Boolean)
          .join(" ");
        const formattedDate = new Date(dueDate).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
        });

        const draftInput = {
          garageName: org?.name ?? location.name,
          garagePhone: org?.phone ?? null,
          customerFirstName: firstName,
          registration: vehicle.registration,
          vehicleDescription: vehicleDescription || vehicle.registration,
          reminderType,
          dueDate: formattedDate,
        };

        let messageText: string;
        try {
          messageText = await draftReminderMessage(draftInput);
        } catch {
          messageText = fallbackReminderMessage(draftInput);
        }

        const label = reminderType === "mot" ? "MOT" : "service";
        const subject = `${label.toUpperCase()} reminder — ${vehicle.registration} due ${formattedDate}`;

        const emailResult = await sendEmail({
          to: customer.email,
          subject,
          text: messageText,
        });

        await admin.from("reminders").insert({
          location_id: location.id,
          customer_id: customer.id,
          vehicle_id: vehicle.id,
          type: reminderType,
          channel: "email",
          recipient_email: customer.email,
          subject,
          message_text: messageText,
          status: emailResult.success ? "sent" : "failed",
          error_message: emailResult.success ? null : emailResult.error,
        });

        if (emailResult.success) {
          results.sent++;
        } else {
          results.failed++;
          results.errors.push(
            `${vehicle.registration} (${reminderType}): ${emailResult.error}`,
          );
        }
      }
    }
  }

  console.log("[cron/reminders]", results);
  return NextResponse.json({ success: true, ...results });
}
