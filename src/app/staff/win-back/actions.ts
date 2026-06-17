"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, tenantBookingUrl } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import { sendWhatsApp } from "@/lib/whatsapp";
import { logAudit } from "@/lib/audit";
import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage } from "@/lib/ai-usage";
import { getOrgAiBrief, aiBriefSystemBlock } from "@/lib/ai-profile";

const anthropic = new Anthropic();
const MODEL = "claude-haiku-4-5-20251001";

// Win-back drafts never mention that we know the MOT happened elsewhere —
// the customer is invited back warmly, not surveilled.
const EMAIL_SYSTEM = `You draft short re-engagement emails for UK garages, aimed at customers who haven't visited in a while. British English. Under 110 words.
Start with "Hi [first name]," — no subject line, no sign-off placeholder.
Tone: warm, no guilt-tripping, no pressure. Mention their vehicle naturally.
Never mention MOT history, where they had work done, or anything implying the garage tracks them.

Call to action rules — STRICT:
- Direct the customer to click the button below to book.
- Do NOT ask them to call, phone, ring, or reply to the email.
- Do NOT include a phone number, email address, or any other contact detail.
- A "Book your appointment" button is appended automatically — do not include a link or URL yourself.`;

const SMS_SYSTEM = `You draft short re-engagement SMS messages for UK garages. Max 130 characters (a booking link is appended after).
British English. Include: customer first name, vehicle registration, garage name. Warm, no pressure.
Never mention MOT history or where they had work done.

Call to action rules — STRICT:
- Point the customer to the link below to book.
- Do NOT ask them to call, phone, or reply.
- Do NOT include a phone number or URL — the booking link is appended automatically.`;

type WinBackVehicleRow = {
  id: string;
  registration: string;
  make: string | null;
  model: string | null;
  year: number | null;
  moted_elsewhere_at: string | null;
  customer: {
    id: string;
    full_name: string | null;
    email: string | null;
    phone: string | null;
    marketing_email_consent: boolean;
    marketing_sms_consent: boolean;
    anonymized_at: string | null;
  } | null;
};

async function loadWinBackVehicle(vehicleId: string, locationId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("vehicles")
    .select(
      "id, registration, make, model, year, moted_elsewhere_at, customer:customers(id, full_name, email, phone, marketing_email_consent, marketing_sms_consent, anonymized_at)",
    )
    .eq("id", vehicleId)
    .eq("location_id", locationId)
    .maybeSingle();
  return data as unknown as WinBackVehicleRow | null;
}

function fallbackWinBackEmail(firstName: string, vehicleDescription: string, garageName: string) {
  return `Hi ${firstName},

It's been a while since we last saw your ${vehicleDescription} at ${garageName}. We'd love to help keep it running at its best — whether that's a service, repairs, or just a quick check-over.

If there's anything it needs, you can book in a couple of clicks using the button below.

Hope to see you soon!`;
}

function fallbackWinBackSms(firstName: string, registration: string, garageName: string) {
  return `Hi ${firstName}, it's been a while since we saw ${registration} at ${garageName}. We'd love to help with its next service — book below.`;
}

export type WinBackPreviewResult = { error: string } | { email: string; sms: string; subject: string };

export async function draftWinBackPreview(vehicleId: string): Promise<WinBackPreviewResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "campaigns")) return { error: "Permission denied." };

  const vehicle = await loadWinBackVehicle(vehicleId, ctx.location.id);
  if (!vehicle || !vehicle.customer) return { error: "Vehicle or customer not found." };
  if (vehicle.customer.anonymized_at) return { error: "Customer has been anonymised." };

  const firstName = vehicle.customer.full_name?.split(" ")[0] ?? "there";
  const vehicleDescription =
    [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || vehicle.registration;
  const garageName = ctx.organization.name;
  const subject = `We'd love to see your ${vehicle.make ?? "vehicle"} again — ${garageName}`;
  const aiBrief = await getOrgAiBrief(createAdminClient(), ctx.organization.id);

  try {
    const [emailRes, smsRes] = await Promise.all([
      anthropic.messages.create({
        model: MODEL,
        max_tokens: 300,
        system: [{ type: "text", text: EMAIL_SYSTEM + aiBriefSystemBlock(aiBrief), cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: `Draft a re-engagement email for:\nGarage: ${garageName}\nCustomer: ${firstName}\nVehicle: ${vehicleDescription} (${vehicle.registration})\n\nStart with "Hi ${firstName},". End by inviting them to book using the button below — no phone number, no URL.`,
          },
        ],
      }),
      anthropic.messages.create({
        model: MODEL,
        max_tokens: 80,
        system: [{ type: "text", text: SMS_SYSTEM + aiBriefSystemBlock(aiBrief), cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: `SMS re-engagement: customer ${firstName}, vehicle ${vehicle.registration}, from ${garageName}. Point them to the link below to book — no phone number, no URL.`,
          },
        ],
      }),
    ]);
    await Promise.all([
      recordAiUsage({
        locationId: ctx.location.id,
        organizationId: ctx.organization.id,
        userId: ctx.user.id,
        feature: "winback_draft",
        model: MODEL,
        usage: emailRes.usage,
      }),
      recordAiUsage({
        locationId: ctx.location.id,
        organizationId: ctx.organization.id,
        userId: ctx.user.id,
        feature: "winback_draft",
        model: MODEL,
        usage: smsRes.usage,
      }),
    ]);

    const emailBlock = emailRes.content[0];
    const smsBlock = smsRes.content[0];
    return {
      email:
        emailBlock.type === "text"
          ? emailBlock.text.trim()
          : fallbackWinBackEmail(firstName, vehicleDescription, garageName),
      sms:
        smsBlock.type === "text"
          ? smsBlock.text.trim()
          : fallbackWinBackSms(firstName, vehicle.registration, garageName),
      subject,
    };
  } catch {
    return {
      email: fallbackWinBackEmail(firstName, vehicleDescription, garageName),
      sms: fallbackWinBackSms(firstName, vehicle.registration, garageName),
      subject,
    };
  }
}

export type SendWinBackResult = { error: string } | { success: true; channels: string[] };

export async function sendWinBack(
  vehicleId: string,
  subject: string,
  emailText: string | null,
  smsText: string | null,
  sendChannels: { email: boolean; sms: boolean; whatsapp: boolean },
): Promise<SendWinBackResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "campaigns")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const vehicle = await loadWinBackVehicle(vehicleId, ctx.location.id);
  if (!vehicle || !vehicle.customer) return { error: "Vehicle or customer not found." };
  if (vehicle.customer.anonymized_at) return { error: "Customer has been anonymised." };

  const customer = vehicle.customer;
  const sentChannels: string[] = [];
  const bookingUrl = tenantBookingUrl(ctx.location.slug);
  const smsWithLink = (body: string) => `${body}\nBook: ${bookingUrl}`;

  // Win-back is marketing, not a service notice — marketing consent is
  // checked per channel, same as campaign broadcasts.
  if (sendChannels.email && emailText) {
    if (!customer.email) sentChannels.push("email skipped: no address");
    else if (!customer.marketing_email_consent) sentChannels.push("email skipped: no consent");
    else {
      const result = await sendEmail({
        to: customer.email,
        subject,
        text: emailText,
        cta: { url: bookingUrl, label: "Book your appointment" },
      });
      await admin.from("reminders").insert({
        location_id: ctx.location.id,
        customer_id: customer.id,
        vehicle_id: vehicle.id,
        type: "custom",
        channel: "email",
        recipient_email: customer.email,
        recipient_phone: null,
        subject,
        message_text: emailText,
        status: result.success ? "sent" : "failed",
        error_message: result.success ? null : result.error,
        resend_email_id: result.success ? result.messageId : null,
      });
      sentChannels.push(result.success ? "email" : `email failed: ${result.error}`);
    }
  }

  for (const channel of ["sms", "whatsapp"] as const) {
    if (!sendChannels[channel] || !smsText) continue;
    if (!customer.phone) {
      sentChannels.push(`${channel} skipped: no phone`);
      continue;
    }
    if (!customer.marketing_sms_consent) {
      sentChannels.push(`${channel} skipped: no consent`);
      continue;
    }
    const send = channel === "sms" ? sendSms : sendWhatsApp;
    const result = await send({ to: customer.phone, body: smsWithLink(smsText) });
    await admin.from("reminders").insert({
      location_id: ctx.location.id,
      customer_id: customer.id,
      vehicle_id: vehicle.id,
      type: "custom",
      channel,
      recipient_email: null,
      recipient_phone: customer.phone,
      subject,
      message_text: smsText,
      status: result.success ? "sent" : "failed",
      error_message: result.success ? null : result.error,
    });
    sentChannels.push(result.success ? channel : `${channel} failed: ${result.error}`);
  }

  const succeeded = sentChannels.filter((c) => !c.includes("failed") && !c.includes("skipped"));
  if (succeeded.length === 0) {
    return { error: `Nothing sent — ${sentChannels.join("; ") || "no channel selected"}.` };
  }

  // Contacted = handled; drop off the win-back list.
  await admin.from("vehicles").update({ moted_elsewhere_at: null }).eq("id", vehicle.id);
  await logAudit({
    organizationId: ctx.organization.id,
    action: "winback.send",
    entityType: "vehicle",
    entityId: vehicle.id,
    metadata: { registration: vehicle.registration, customer_id: customer.id, channels: succeeded },
  });

  revalidatePath("/staff/win-back");
  return { success: true, channels: succeeded };
}

export type DismissWinBackResult = { error: string } | { success: true };

export async function dismissWinBack(vehicleId: string): Promise<DismissWinBackResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "campaigns")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const vehicle = await loadWinBackVehicle(vehicleId, ctx.location.id);
  if (!vehicle) return { error: "Vehicle not found." };

  await admin.from("vehicles").update({ moted_elsewhere_at: null }).eq("id", vehicle.id);
  await logAudit({
    organizationId: ctx.organization.id,
    action: "winback.dismiss",
    entityType: "vehicle",
    entityId: vehicle.id,
    metadata: { registration: vehicle.registration },
  });

  revalidatePath("/staff/win-back");
  return { success: true };
}
