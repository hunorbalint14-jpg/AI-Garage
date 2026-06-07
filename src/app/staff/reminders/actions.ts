"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, tenantBookingUrl } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import { sendWhatsApp } from "@/lib/whatsapp";
import Anthropic from "@anthropic-ai/sdk";
import { fallbackReminderMessage, fallbackSmsReminderMessage } from "@/lib/ai-messages";
import { recordAiUsage } from "@/lib/ai-usage";

const anthropic = new Anthropic();
const MODEL = "claude-haiku-4-5-20251001";

const EMAIL_SYSTEM = `You draft short vehicle reminder emails for UK garages. British English. Under 120 words.
Start with "Hi [first name]," — no subject line, no sign-off placeholder.

Call to action rules — STRICT:
- Direct the customer to click the button below to book.
- Do NOT ask them to call, phone, ring, or reply to the email.
- Do NOT include a phone number, email address, or any other contact detail.
- A "Book your appointment" button is appended automatically — do not include a link or URL yourself.`;

const SMS_SYSTEM = `You draft short SMS reminders for UK garages. Max 130 characters (a booking link is appended after).
British English. Include: customer first name, vehicle registration, reminder type, due date, garage name.

Call to action rules — STRICT:
- Point the customer to the link below to book.
- Do NOT ask them to call, phone, or reply.
- Do NOT include a phone number or URL — the booking link is appended automatically.`;

const TONE_NOTES: Record<string, string> = {
  friendly: "Friendly and approachable — warm, like talking to a regular customer.",
  direct: "Direct and professional — concise, focused on urgency.",
  warm: "Very warm and personal — like a trusted local mechanic who knows the customer well.",
};

export type ReminderPreviewResult =
  | { error: string }
  | { email: string; sms: string; subject: string };

export async function draftReminderPreview(
  vehicleId: string,
  reminderType: "mot" | "service",
  tone: "friendly" | "direct" | "warm" = "friendly",
): Promise<ReminderPreviewResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "reminders")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const [vehicleRes, orgRes] = await Promise.all([
    admin
      .from("vehicles")
      .select(
        "id, registration, make, model, year, mot_expiry, service_due, customer:customers(id, full_name, email, phone)",
      )
      .eq("id", vehicleId)
      .maybeSingle(),
    admin.from("organizations").select("name, phone").eq("id", ctx.organization.id).maybeSingle(),
  ]);

  type VehicleRow = {
    id: string;
    registration: string;
    make: string | null;
    model: string | null;
    year: number | null;
    mot_expiry: string | null;
    service_due: string | null;
    customer: { id: string; full_name: string | null; email: string | null; phone: string | null } | null;
  };

  const vehicle = vehicleRes.data as VehicleRow | null;
  const org = orgRes.data;
  if (!vehicle || !vehicle.customer) return { error: "Vehicle or customer not found." };

  const customer = vehicle.customer;
  const label = reminderType === "mot" ? "MOT" : "service";
  const dueDate = reminderType === "mot" ? vehicle.mot_expiry : vehicle.service_due;
  if (!dueDate) return { error: `No ${label} date set for this vehicle.` };

  const firstName = customer.full_name?.split(" ")[0] ?? "there";
  const vehicleDescription =
    [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || vehicle.registration;
  const formattedDate = new Date(dueDate).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const garageName = org?.name ?? ctx.organization.name;
  const garagePhone = org?.phone ?? null;
  const subject = `${label.toUpperCase()} reminder — ${vehicle.registration} due ${formattedDate}`;
  const toneNote = TONE_NOTES[tone];

  const draftInput = {
    garageName,
    garagePhone,
    customerFirstName: firstName,
    registration: vehicle.registration,
    vehicleDescription,
    reminderType,
    dueDate: formattedDate,
  };

  try {
    const [emailRes, smsRes] = await Promise.all([
      anthropic.messages.create({
        model: MODEL,
        max_tokens: 300,
        system: [{ type: "text", text: EMAIL_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: `Tone: ${toneNote}\n\nDraft a ${label} reminder for:\nGarage: ${garageName}\nCustomer: ${firstName}\nVehicle: ${vehicleDescription} (${vehicle.registration})\n${label} due: ${formattedDate}\n\nStart with "Hi ${firstName},". End by inviting them to book using the button below — no phone number, no URL.`,
          },
        ],
      }),
      anthropic.messages.create({
        model: MODEL,
        max_tokens: 80,
        system: [{ type: "text", text: SMS_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: `Tone: ${toneNote}\n\nSMS ${label} reminder: customer ${firstName}, vehicle ${vehicle.registration}, due ${formattedDate}, from ${garageName}. Point them to the link below to book — no phone number, no URL.`,
          },
        ],
      }),
    ]);
    await Promise.all([
      recordAiUsage({
        locationId: ctx.location.id,
        organizationId: ctx.organization.id,
        userId: ctx.user.id,
        feature: "reminder_draft",
        model: MODEL,
        usage: emailRes.usage,
      }),
      recordAiUsage({
        locationId: ctx.location.id,
        organizationId: ctx.organization.id,
        userId: ctx.user.id,
        feature: "reminder_draft",
        model: MODEL,
        usage: smsRes.usage,
      }),
    ]);

    const emailBlock = emailRes.content[0];
    const smsBlock = smsRes.content[0];
    return {
      email: emailBlock.type === "text" ? emailBlock.text.trim() : fallbackReminderMessage(draftInput),
      sms: smsBlock.type === "text" ? smsBlock.text.trim() : fallbackSmsReminderMessage(draftInput),
      subject,
    };
  } catch {
    return {
      email: fallbackReminderMessage(draftInput),
      sms: fallbackSmsReminderMessage(draftInput),
      subject,
    };
  }
}

export type SendReminderDraftResult = { error: string } | { success: true; channels: string[] };

export async function sendReminderDraft(
  vehicleId: string,
  reminderType: "mot" | "service",
  emailText: string | null,
  smsText: string | null,
  sendChannels: { email: boolean; sms: boolean; whatsapp: boolean },
): Promise<SendReminderDraftResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "reminders")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const { data: vehicleData } = await admin
    .from("vehicles")
    .select(
      "id, registration, make, model, year, mot_expiry, service_due, customer:customers(id, full_name, email, phone)",
    )
    .eq("id", vehicleId)
    .maybeSingle();

  type VehicleRow = {
    id: string;
    registration: string;
    mot_expiry: string | null;
    service_due: string | null;
    customer: { id: string; full_name: string | null; email: string | null; phone: string | null } | null;
  };

  const vehicle = vehicleData as VehicleRow | null;
  if (!vehicle || !vehicle.customer) return { error: "Vehicle or customer not found." };

  const customer = vehicle.customer;
  const label = reminderType === "mot" ? "MOT" : "service";
  const dueDate = reminderType === "mot" ? vehicle.mot_expiry : vehicle.service_due;
  const formattedDate = dueDate
    ? new Date(dueDate).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "soon";
  const subject = `${label.toUpperCase()} reminder — ${vehicle.registration} due ${formattedDate}`;
  const sentChannels: string[] = [];

  const bookingUrl = tenantBookingUrl(ctx.location.slug);
  const bookingCta = { url: bookingUrl, label: "Book your appointment" };

  if (sendChannels.email && emailText && customer.email) {
    const result = await sendEmail({ to: customer.email, subject, text: emailText, cta: bookingCta });
    await admin.from("reminders").insert({
      location_id: ctx.location.id,
      customer_id: customer.id,
      vehicle_id: vehicle.id,
      type: reminderType,
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

  const smsWithLink = (body: string) => `${body}\nBook: ${bookingUrl}`;

  if (sendChannels.sms && smsText && customer.phone) {
    const result = await sendSms({ to: customer.phone, body: smsWithLink(smsText) });
    await admin.from("reminders").insert({
      location_id: ctx.location.id,
      customer_id: customer.id,
      vehicle_id: vehicle.id,
      type: reminderType,
      channel: "sms",
      recipient_email: null,
      recipient_phone: customer.phone,
      subject,
      message_text: smsText,
      status: result.success ? "sent" : "failed",
      error_message: result.success ? null : result.error,
    });
    sentChannels.push(result.success ? "SMS" : `SMS failed: ${result.error}`);
  }

  if (sendChannels.whatsapp && smsText && customer.phone) {
    const result = await sendWhatsApp({ to: customer.phone, body: smsWithLink(smsText) });
    await admin.from("reminders").insert({
      location_id: ctx.location.id,
      customer_id: customer.id,
      vehicle_id: vehicle.id,
      type: reminderType,
      channel: "whatsapp",
      recipient_email: null,
      recipient_phone: customer.phone,
      subject,
      message_text: smsText,
      status: result.success ? "sent" : "failed",
      error_message: result.success ? null : result.error,
    });
    sentChannels.push(result.success ? "WhatsApp" : `WhatsApp failed: ${result.error}`);
  }

  if (sentChannels.length === 0) return { error: "No valid channel selected." };

  revalidatePath("/staff/reminders");
  return {
    success: true,
    channels: sentChannels.filter((c) => !c.includes("failed")),
  };
}
