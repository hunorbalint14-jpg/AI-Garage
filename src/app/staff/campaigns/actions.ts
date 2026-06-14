"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmailBatch, tenantBookingUrl, type BatchEmailItemResult } from "@/lib/email";
import { logAudit } from "@/lib/audit";
import { sendSms, type SendSmsResult } from "@/lib/sms";
import { sendWhatsApp, type SendWhatsAppResult } from "@/lib/whatsapp";
import { mapWithConcurrency, chunk } from "@/lib/concurrency";
import { draftBroadcastMessage } from "@/lib/ai-messages";
import { enforceRateLimit, tooManyAttemptsError } from "@/lib/rate-limit";
import { entitledTo, UPGRADE_MESSAGE } from "@/lib/tenant-plans";

export type DraftBroadcastPreviewResult =
  | { error: string }
  | { subject: string; email: string; sms: string; emailCount: number; smsCount: number; whatsappCount: number };

export async function draftBroadcastPreview(
  topic: string,
  channels: ("email" | "sms" | "whatsapp")[],
): Promise<DraftBroadcastPreviewResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "campaigns")) return { error: "Permission denied." };
  if (!entitledTo(ctx.tenantBilling, "campaigns")) return { error: UPGRADE_MESSAGE.campaigns };

  const limited = await enforceRateLimit("ai", ctx.user.id);
  if (!limited.ok) return tooManyAttemptsError(limited.retryAfter);

  const admin = createAdminClient();

  const [customersRes, orgRes] = await Promise.all([
    admin.from("customers").select("email, phone").eq("organization_id", ctx.organization.id),
    admin.from("organizations").select("name, phone").eq("id", ctx.organization.id).maybeSingle(),
  ]);

  const customers = customersRes.data ?? [];
  const emailCount = channels.includes("email") ? customers.filter((c) => c.email).length : 0;
  const smsCount = channels.includes("sms") ? customers.filter((c) => c.phone).length : 0;
  const whatsappCount = channels.includes("whatsapp") ? customers.filter((c) => c.phone).length : 0;

  if (emailCount + smsCount + whatsappCount === 0) {
    return { error: "No customers with matching contact details at this location." };
  }

  const garageName = orgRes.data?.name ?? ctx.organization.name;
  const garagePhone = orgRes.data?.phone ?? null;

  try {
    const drafted = await draftBroadcastMessage(
      {
        garageName,
        garagePhone,
        topic,
        needEmail: channels.includes("email"),
        needSms: channels.includes("sms"),
      },
      {
        locationId: ctx.location.id,
        organizationId: ctx.organization.id,
        userId: ctx.user.id,
        feature: "campaign_draft",
      },
    );
    return { ...drafted, emailCount, smsCount, whatsappCount };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `AI draft failed: ${msg}` };
  }
}

export type SendBroadcastResult =
  | { error: string }
  | {
      success: true;
      emailSent: number;
      smsSent: number;
      whatsappSent: number;
      emailFailed: number;
      smsFailed: number;
      whatsappFailed: number;
      skippedNoEmail: number;
      skippedNoPhone: number;
      skippedNoEmailConsent: number;
      skippedNoSmsConsent: number;
      failureSamples: { recipient: string; channel: string; reason: string }[];
    };

const MAX_CUSTOMERS = 500;

export async function sendBroadcast(
  subjectInput: string,
  emailText: string | null,
  smsText: string | null,
  whatsappText: string | null,
): Promise<SendBroadcastResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "campaigns")) return { error: "Permission denied." };
  if (!entitledTo(ctx.tenantBilling, "campaigns")) return { error: UPGRADE_MESSAGE.campaigns };

  const admin = createAdminClient();

  const { data: customersData } = await admin
    .from("customers")
    .select("id, email, phone, marketing_email_consent, marketing_sms_consent, anonymized_at")
    .eq("organization_id", ctx.organization.id)
    .is("anonymized_at", null)
    .limit(MAX_CUSTOMERS);

  const customers = customersData ?? [];
  if (!customers.length) return { error: "No customers found." };

  const cleanSubject = subjectInput.trim().slice(0, 120);
  if (!cleanSubject) return { error: "Subject is required." };
  const subject = cleanSubject;

  const bookingUrl = tenantBookingUrl(ctx.location.slug);
  const bookingCta = { url: bookingUrl, label: "Visit our garage" };
  const smsWithLink = (body: string) => `${body}\n${bookingUrl}`;

  let emailSent = 0, emailFailed = 0, smsSent = 0, smsFailed = 0, whatsappSent = 0, whatsappFailed = 0;
  let skippedNoEmail = 0, skippedNoPhone = 0, skippedNoEmailConsent = 0, skippedNoSmsConsent = 0;
  const failureSamples: { recipient: string; channel: string; reason: string }[] = [];
  const pushFailure = (recipient: string, channel: string, reason: string) => {
    if (failureSamples.length < 10) failureSamples.push({ recipient, channel, reason });
  };

  // Partition recipients per channel up front (counting skips), then send each
  // channel in bulk: Resend's batch endpoint for email, a bounded concurrency
  // pool for Twilio. The previous one-await-per-customer loop took minutes at
  // 500 customers and timed out the action mid-send.
  type Customer = (typeof customers)[number];
  const emailRecipients: Customer[] = [];
  const smsRecipients: Customer[] = [];
  const whatsappRecipients: Customer[] = [];

  for (const customer of customers) {
    if (emailText) {
      if (!customer.email) skippedNoEmail++;
      else if (!customer.marketing_email_consent) skippedNoEmailConsent++;
      else emailRecipients.push(customer);
    }
    if (smsText) {
      if (!customer.phone) skippedNoPhone++;
      else if (!customer.marketing_sms_consent) skippedNoSmsConsent++;
      else smsRecipients.push(customer);
    }
    if (whatsappText) {
      if (!customer.phone) {
        // already counted under skippedNoPhone if smsText also empty; only add when not double-counted
        if (!smsText) skippedNoPhone++;
      } else if (!customer.marketing_sms_consent) {
        if (!smsText) skippedNoSmsConsent++;
      } else {
        whatsappRecipients.push(customer);
      }
    }
  }

  const TWILIO_CONCURRENCY = 8;
  const [emailResults, smsResults, whatsappResults] = await Promise.all([
    emailText
      ? sendEmailBatch(
          emailRecipients.map((c) => ({ to: c.email!, subject, text: emailText, cta: bookingCta })),
        )
      : Promise.resolve([] as BatchEmailItemResult[]),
    mapWithConcurrency(smsRecipients, TWILIO_CONCURRENCY, (c) =>
      sendSms({ to: c.phone!, body: smsWithLink(smsText ?? "") }),
    ),
    mapWithConcurrency(whatsappRecipients, TWILIO_CONCURRENCY, (c) =>
      sendWhatsApp({ to: c.phone!, body: smsWithLink(whatsappText ?? "") }),
    ),
  ]);

  const settledToResult = (r: PromiseSettledResult<SendSmsResult | SendWhatsAppResult>) =>
    r.status === "fulfilled"
      ? r.value
      : ({ success: false, error: String(r.reason) } as const);

  type ReminderRow = {
    location_id: string;
    customer_id: string;
    vehicle_id: null;
    type: "campaign";
    channel: "email" | "sms" | "whatsapp";
    recipient_email: string | null;
    recipient_phone: string | null;
    subject: string;
    message_text: string;
    status: "sent" | "failed";
    error_message: string | null;
    resend_email_id?: string | null;
  };
  const rows: ReminderRow[] = [];

  emailRecipients.forEach((customer, i) => {
    const result = emailResults[i];
    rows.push({
      location_id: ctx.location.id,
      customer_id: customer.id,
      vehicle_id: null,
      type: "campaign",
      channel: "email",
      recipient_email: customer.email,
      recipient_phone: null,
      subject,
      message_text: emailText!,
      status: result.success ? "sent" : "failed",
      error_message: result.error,
      resend_email_id: result.messageId,
    });
    if (result.success) emailSent++;
    else {
      emailFailed++;
      pushFailure(customer.email!, "email", result.error ?? "Unknown email error");
    }
  });

  smsRecipients.forEach((customer, i) => {
    const result = settledToResult(smsResults[i]);
    rows.push({
      location_id: ctx.location.id,
      customer_id: customer.id,
      vehicle_id: null,
      type: "campaign",
      channel: "sms",
      recipient_email: null,
      recipient_phone: customer.phone,
      subject,
      message_text: smsText!,
      status: result.success ? "sent" : "failed",
      error_message: result.success ? null : result.error,
    });
    if (result.success) smsSent++;
    else {
      smsFailed++;
      pushFailure(customer.phone!, "sms", result.error);
    }
  });

  whatsappRecipients.forEach((customer, i) => {
    const result = settledToResult(whatsappResults[i]);
    rows.push({
      location_id: ctx.location.id,
      customer_id: customer.id,
      vehicle_id: null,
      type: "campaign",
      channel: "whatsapp",
      recipient_email: null,
      recipient_phone: customer.phone,
      subject,
      message_text: whatsappText!,
      status: result.success ? "sent" : "failed",
      error_message: result.success ? null : result.error,
    });
    if (result.success) whatsappSent++;
    else {
      whatsappFailed++;
      pushFailure(customer.phone!, "whatsapp", result.error);
    }
  });

  // Outcome log rows in bulk (was one insert round-trip per send). Insert
  // failures are logged but don't fail the broadcast — the sends already went.
  for (const insertChunk of chunk(rows, 500)) {
    const { error: insertError } = await admin.from("reminders").insert(insertChunk);
    if (insertError) console.error("[campaigns] reminders insert failed:", insertError.message);
  }

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "campaign.send",
    entityType: "location",
    entityId: ctx.location.id,
    metadata: {
      subject,
      email_sent: emailSent,
      sms_sent: smsSent,
      whatsapp_sent: whatsappSent,
      email_failed: emailFailed,
      sms_failed: smsFailed,
      whatsapp_failed: whatsappFailed,
      skipped_no_email_consent: skippedNoEmailConsent,
      skipped_no_sms_consent: skippedNoSmsConsent,
    },
  });

  revalidatePath("/staff/campaigns");
  revalidatePath("/staff/reminders");
  return {
    success: true,
    emailSent,
    smsSent,
    whatsappSent,
    emailFailed,
    smsFailed,
    whatsappFailed,
    skippedNoEmail,
    skippedNoPhone,
    skippedNoEmailConsent,
    skippedNoSmsConsent,
    failureSamples,
  };
}
