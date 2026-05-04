"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import { draftBroadcastMessage } from "@/lib/ai-messages";

export type DraftBroadcastPreviewResult =
  | { error: string }
  | { email: string; sms: string; emailCount: number; smsCount: number };

export async function draftBroadcastPreview(
  topic: string,
  channels: ("email" | "sms")[],
): Promise<DraftBroadcastPreviewResult> {
  const ctx = await requireStaffContext();
  if (!ctx.orgRole) return { error: "Only org owners and admins can send campaigns." };

  const admin = createAdminClient();

  const [customersRes, orgRes] = await Promise.all([
    admin.from("customers").select("email, phone").eq("location_id", ctx.location.id),
    admin.from("organizations").select("name, phone").eq("id", ctx.organization.id).maybeSingle(),
  ]);

  const customers = customersRes.data ?? [];
  const emailCount = channels.includes("email") ? customers.filter((c) => c.email).length : 0;
  const smsCount = channels.includes("sms") ? customers.filter((c) => c.phone).length : 0;

  if (emailCount + smsCount === 0) {
    return { error: "No customers with matching contact details at this location." };
  }

  const garageName = orgRes.data?.name ?? ctx.organization.name;
  const garagePhone = orgRes.data?.phone ?? null;

  try {
    const drafted = await draftBroadcastMessage({ garageName, garagePhone, topic });
    return { ...drafted, emailCount, smsCount };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `AI draft failed: ${msg}` };
  }
}

export type SendBroadcastResult =
  | { error: string }
  | { success: true; emailSent: number; smsSent: number; emailFailed: number; smsFailed: number };

const MAX_CUSTOMERS = 500;

export async function sendBroadcast(
  topic: string,
  emailText: string | null,
  smsText: string | null,
): Promise<SendBroadcastResult> {
  const ctx = await requireStaffContext();
  if (!ctx.orgRole) return { error: "Only org owners and admins can send campaigns." };

  const admin = createAdminClient();

  const [customersRes, orgRes] = await Promise.all([
    admin.from("customers").select("id, email, phone").eq("location_id", ctx.location.id).limit(MAX_CUSTOMERS),
    admin.from("organizations").select("name").eq("id", ctx.organization.id).maybeSingle(),
  ]);

  const customers = customersRes.data ?? [];
  if (!customers.length) return { error: "No customers found at this location." };

  const garageName = orgRes.data?.name ?? ctx.organization.name;
  const subject = `${garageName} — ${topic.slice(0, 60)}`;

  let emailSent = 0, emailFailed = 0, smsSent = 0, smsFailed = 0;

  for (const customer of customers) {
    if (emailText && customer.email) {
      const result = await sendEmail({ to: customer.email, subject, text: emailText });
      await admin.from("reminders").insert({
        location_id: ctx.location.id,
        customer_id: customer.id,
        vehicle_id: null,
        type: "campaign",
        channel: "email",
        recipient_email: customer.email,
        recipient_phone: null,
        subject,
        message_text: emailText,
        status: result.success ? "sent" : "failed",
        error_message: result.success ? null : result.error,
        resend_email_id: result.success ? result.messageId : null,
      });
      result.success ? emailSent++ : emailFailed++;
    }

    if (smsText && customer.phone) {
      const result = await sendSms({ to: customer.phone, body: smsText });
      await admin.from("reminders").insert({
        location_id: ctx.location.id,
        customer_id: customer.id,
        vehicle_id: null,
        type: "campaign",
        channel: "sms",
        recipient_email: null,
        recipient_phone: customer.phone,
        subject,
        message_text: smsText,
        status: result.success ? "sent" : "failed",
        error_message: result.success ? null : result.error,
      });
      result.success ? smsSent++ : smsFailed++;
    }
  }

  revalidatePath("/staff/campaigns");
  revalidatePath("/staff/reminders");
  return { success: true, emailSent, smsSent, emailFailed, smsFailed };
}
