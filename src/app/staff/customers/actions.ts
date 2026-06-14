"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeRegistration, validateRegistration } from "@/lib/registration";
import { emailSchema, nameSchema, phoneSchema, parseOrError } from "@/lib/validation";
import { enforceRateLimit, tooManyAttemptsError } from "@/lib/rate-limit";
import { z } from "zod";
import { lookupVehicle, type DvsaVehicle } from "@/lib/dvla";
import { lookupVehicleVes } from "@/lib/dvla-ves";
import { checkVehicleRecalls } from "@/lib/dvsa-recalls";
import { sendEmail, tenantBookingUrl } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import { sendWhatsApp } from "@/lib/whatsapp";
import { logAudit } from "@/lib/audit";
import {
  draftReminderMessage,
  draftSmsReminderMessage,
  draftCustomMessage,
  fallbackReminderMessage,
  fallbackSmsReminderMessage,
} from "@/lib/ai-messages";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const addCustomerSchema = z.object({
  fullName: nameSchema,
  email: emailSchema,
  phone: phoneSchema,
});

export type AddCustomerResult = { error: string } | { customerId: string };

export async function addCustomer(formData: FormData): Promise<AddCustomerResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "customers")) return { error: "Permission denied." };

  const parsed = parseOrError(addCustomerSchema, {
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    phone: formData.get("phone") ?? undefined,
  });
  if ("error" in parsed) return parsed;
  const { fullName, email, phone } = parsed.data;

  const { data, error } = await ctx.supabase
    .from("customers")
    .insert({
      organization_id: ctx.organization.id,
      location_id: ctx.location.id,
      preferred_location_id: ctx.location.id,
      full_name: fullName,
      email,
      phone: phone ?? null,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return { error: "A customer with that email already exists." };
    return { error: error.message };
  }

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "customer.create",
    entityType: "customer",
    entityId: data.id,
    metadata: { full_name: fullName, email, phone, location_id: ctx.location.id },
  });

  revalidatePath("/staff/customers");
  return { customerId: data.id };
}

export type RecallCheckResult =
  | { error: string }
  | { hasRecall: boolean; recalls: { makeModel: string; recallNumber: string; defectDescription: string; remedyDescription: string; recallDate: string }[] };

export async function checkRecalls(vehicleId: string, registration: string): Promise<RecallCheckResult> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();
  const result = await checkVehicleRecalls(registration);
  if (!result.success) return { error: result.error };

  // Store recall status on the vehicle
  await admin.from("vehicles").update({
    recall_status: result.hasRecall ? "has_recall" : "clear",
    recall_checked_at: new Date().toISOString(),
    recall_detail: result.hasRecall ? JSON.stringify(result.recalls) : null,
  }).eq("id", vehicleId).eq("organization_id", ctx.organization.id);

  revalidatePath("/staff/customers");
  return { hasRecall: result.hasRecall, recalls: result.recalls };
}

export type VedLookupResult = { error: string } | { taxDueDate: string | null; taxStatus: string | null };

export async function vedLookup(registration: string): Promise<VedLookupResult> {
  await requireStaffContext();
  const result = await lookupVehicleVes(registration);
  if (!result.success) return { error: result.error };
  return { taxDueDate: result.taxDueDate, taxStatus: result.taxStatus };
}

export type DvlaLookupResult = { error: string } | { vehicle: DvsaVehicle };

export async function dvlaLookup(registration: string): Promise<DvlaLookupResult> {
  await requireStaffContext();
  const regError = validateRegistration(registration);
  if (regError) return { error: regError };
  const result = await lookupVehicle(registration);
  if (!result.success) return { error: result.error };
  return { vehicle: result.vehicle };
}

export type AddVehicleResult = { error: string } | { vehicleId: string; customerId: string };

export async function addVehicle(customerId: string, formData: FormData): Promise<AddVehicleResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "customers")) return { error: "Permission denied." };

  const registrationInput = formData.get("registration") as string | null;
  const make = (formData.get("make") as string | null)?.trim() || null;
  const model = (formData.get("model") as string | null)?.trim() || null;
  const yearStr = formData.get("year") as string | null;
  const motExpiry = (formData.get("motExpiry") as string | null) || null;
  const serviceDue = (formData.get("serviceDue") as string | null) || null;
  const taxDueDate = (formData.get("taxDueDate") as string | null) || null;

  const regError = validateRegistration(registrationInput ?? "");
  if (regError) return { error: regError };
  const registration = normalizeRegistration(registrationInput ?? "");

  let year: number | null = null;
  if (yearStr) {
    const parsed = parseInt(yearStr, 10);
    const currentYear = new Date().getFullYear();
    if (Number.isNaN(parsed) || parsed < 1900 || parsed > currentYear + 1) {
      return { error: `Year must be between 1900 and ${currentYear + 1}.` };
    }
    year = parsed;
  }

  const { data: customer } = await ctx.supabase
    .from("customers")
    .select("id")
    .eq("id", customerId)
    .maybeSingle();
  if (!customer) return { error: "Customer not found." };

  const { data, error } = await ctx.supabase
    .from("vehicles")
    .insert({ location_id: ctx.location.id, customer_id: customerId, registration, make, model, year, mot_expiry: motExpiry, service_due: serviceDue, tax_due_date: taxDueDate })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return { error: "A vehicle with that registration is already on file." };
    return { error: error.message };
  }

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "vehicle.create",
    entityType: "vehicle",
    entityId: data.id,
    metadata: { registration, customer_id: customerId, make, model, year },
  });

  revalidatePath(`/staff/customers/${customerId}`);
  return { vehicleId: data.id, customerId };
}

export type SendReminderResult = { error: string } | { success: true; channels: string[] };

export async function sendReminder(
  vehicleId: string,
  reminderType: "mot" | "service",
): Promise<SendReminderResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "reminders")) return { error: "Permission denied." };

  const limited = await enforceRateLimit("ai", ctx.user.id);
  if (!limited.ok) return tooManyAttemptsError(limited.retryAfter);

  const admin = createAdminClient();

  const [vehicleRes, orgRes] = await Promise.all([
    admin
      .from("vehicles")
      .select("id, registration, make, model, year, mot_expiry, service_due, customer:customers(id, full_name, email, phone)")
      .eq("id", vehicleId)
      .maybeSingle(),
    admin
      .from("organizations")
      .select("name, phone")
      .eq("id", ctx.organization.id)
      .maybeSingle(),
  ]);

  type VehicleWithCustomer = {
    id: string;
    registration: string;
    make: string | null;
    model: string | null;
    year: number | null;
    mot_expiry: string | null;
    service_due: string | null;
    customer: { id: string; full_name: string | null; email: string | null; phone: string | null } | null;
  };

  const vehicle = vehicleRes.data as VehicleWithCustomer | null;
  const org = orgRes.data;

  if (!vehicle) return { error: "Vehicle not found." };
  if (!vehicle.customer) return { error: "Customer not found." };

  const customer = vehicle.customer;
  if (!customer.email && !customer.phone) {
    return { error: "Customer has no email or phone number on file." };
  }

  const dueDate = reminderType === "mot" ? vehicle.mot_expiry : vehicle.service_due;
  if (!dueDate) {
    return { error: `No ${reminderType === "mot" ? "MOT expiry" : "service due"} date set for this vehicle.` };
  }

  const firstName = customer.full_name?.split(" ")[0] ?? "there";
  const vehicleDescription = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ");
  const formattedDate = new Date(dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const label = reminderType === "mot" ? "MOT" : "service";

  const draftInput = {
    garageName: org?.name ?? ctx.organization.name,
    garagePhone: org?.phone ?? null,
    customerFirstName: firstName,
    registration: vehicle.registration,
    vehicleDescription: vehicleDescription || vehicle.registration,
    reminderType,
    dueDate: formattedDate,
  };
  const aiCtx = {
    locationId: ctx.location.id,
    organizationId: ctx.organization.id,
    userId: ctx.user.id,
    feature: "reminder_send",
  };

  const sentChannels: string[] = [];
  const bookingUrl = tenantBookingUrl(ctx.location.slug);
  const bookingCta = { url: bookingUrl, label: "Book your appointment" };
  const withLink = (body: string) => `${body}\nBook: ${bookingUrl}`;

  // Email channel
  if (customer.email) {
    let messageText: string;
    try {
      messageText = await draftReminderMessage(draftInput, aiCtx);
    } catch {
      messageText = fallbackReminderMessage(draftInput);
    }

    const subject = `${label.toUpperCase()} reminder — ${vehicle.registration} due ${formattedDate}`;
    const emailResult = await sendEmail({ to: customer.email, subject, text: messageText, cta: bookingCta });

    await admin.from("reminders").insert({
      location_id: ctx.location.id,
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

    sentChannels.push(emailResult.success ? "email" : `email (failed: ${emailResult.error})`);
  }

  // SMS channel
  if (customer.phone) {
    let smsText: string;
    try {
      smsText = await draftSmsReminderMessage(draftInput, aiCtx);
    } catch {
      smsText = fallbackSmsReminderMessage(draftInput);
    }

    const smsResult = await sendSms({ to: customer.phone, body: withLink(smsText) });

    await admin.from("reminders").insert({
      location_id: ctx.location.id,
      customer_id: customer.id,
      vehicle_id: vehicle.id,
      type: reminderType,
      channel: "sms",
      recipient_email: null,
      recipient_phone: customer.phone,
      subject: `${label.toUpperCase()} reminder — ${vehicle.registration} due ${formattedDate}`,
      message_text: smsText,
      status: smsResult.success ? "sent" : "failed",
      error_message: smsResult.success ? null : smsResult.error,
    });

    sentChannels.push(smsResult.success ? "SMS" : `SMS (failed: ${smsResult.error})`);
  }

  // WhatsApp channel (uses SMS text — short, personal)
  if (customer.phone) {
    let waText: string;
    try {
      waText = await draftSmsReminderMessage(draftInput, aiCtx);
    } catch {
      waText = fallbackSmsReminderMessage(draftInput);
    }

    const waResult = await sendWhatsApp({ to: customer.phone, body: withLink(waText) });

    await admin.from("reminders").insert({
      location_id: ctx.location.id,
      customer_id: customer.id,
      vehicle_id: vehicle.id,
      type: reminderType,
      channel: "whatsapp",
      recipient_email: null,
      recipient_phone: customer.phone,
      subject: `${label.toUpperCase()} reminder — ${vehicle.registration} due ${formattedDate}`,
      message_text: waText,
      status: waResult.success ? "sent" : "failed",
      error_message: waResult.success ? null : waResult.error,
    });

    sentChannels.push(waResult.success ? "WhatsApp" : `WhatsApp (failed: ${waResult.error})`);
  }

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "reminder.send",
    entityType: "vehicle",
    entityId: vehicle.id,
    metadata: {
      customer_id: customer.id,
      reminder_type: reminderType,
      registration: vehicle.registration,
      channels: sentChannels,
    },
  });

  revalidatePath(`/staff/customers/${customer.id}`);
  revalidatePath("/staff/reminders");
  return { success: true, channels: sentChannels };
}

export type DraftMessagePreviewResult =
  | { error: string }
  | { email: string | null; sms: string | null };

export async function draftMessagePreview(
  customerId: string,
  topic: string,
  channels: ("email" | "sms" | "whatsapp")[],
): Promise<DraftMessagePreviewResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "reminders")) return { error: "Permission denied." };

  const limited = await enforceRateLimit("ai", ctx.user.id);
  if (!limited.ok) return tooManyAttemptsError(limited.retryAfter);

  const admin = createAdminClient();

  const [customerRes, orgRes] = await Promise.all([
    admin.from("customers").select("id, full_name, email, phone").eq("id", customerId).maybeSingle(),
    admin.from("organizations").select("name, phone").eq("id", ctx.organization.id).maybeSingle(),
  ]);

  const customer = customerRes.data as { id: string; full_name: string | null; email: string | null; phone: string | null } | null;
  const org = orgRes.data;

  if (!customer) return { error: "Customer not found." };

  const wantsEmail = channels.includes("email") && !!customer.email;
  const wantsSms = channels.includes("sms") && !!customer.phone;
  const wantsWhatsApp = channels.includes("whatsapp") && !!customer.phone;
  if (!wantsEmail && !wantsSms && !wantsWhatsApp) return { error: "No valid channel available for this customer." };

  // WhatsApp uses the email draft (longer, richer text) — so draft email if email OR whatsapp selected
  const needsEmailDraft = wantsEmail || wantsWhatsApp;

  const firstName = customer.full_name?.split(" ")[0] ?? "there";
  const garageName = org?.name ?? ctx.organization.name;
  const garagePhone = org?.phone ?? null;

  try {
    const drafted = await draftCustomMessage(
      { garageName, garagePhone, customerFirstName: firstName, topic },
      {
        locationId: ctx.location.id,
        organizationId: ctx.organization.id,
        userId: ctx.user.id,
        feature: "message_draft",
      },
    );
    return {
      email: needsEmailDraft ? drafted.email : null,
      sms: wantsSms ? drafted.sms : null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `AI draft failed: ${msg}` };
  }
}

export type SendDraftedMessageResult = { error: string } | { success: true; summary: string };

export async function sendDraftedMessage(
  customerId: string,
  topic: string,
  emailText: string | null,
  smsText: string | null,
  whatsappText: string | null,
): Promise<SendDraftedMessageResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "reminders")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const [customerRes, orgRes] = await Promise.all([
    admin.from("customers").select("id, full_name, email, phone").eq("id", customerId).maybeSingle(),
    admin.from("organizations").select("name, phone").eq("id", ctx.organization.id).maybeSingle(),
  ]);

  const customer = customerRes.data as { id: string; full_name: string | null; email: string | null; phone: string | null } | null;
  const org = orgRes.data;

  if (!customer) return { error: "Customer not found." };

  const garageName = org?.name ?? ctx.organization.name;
  const subject = `Message from ${garageName} — ${topic.slice(0, 60)}`;
  const results: string[] = [];

  if (emailText && customer.email) {
    const emailResult = await sendEmail({ to: customer.email, subject, text: emailText });
    await admin.from("reminders").insert({
      location_id: ctx.location.id,
      customer_id: customer.id,
      vehicle_id: null,
      type: "custom",
      channel: "email",
      recipient_email: customer.email,
      recipient_phone: null,
      subject,
      message_text: emailText,
      status: emailResult.success ? "sent" : "failed",
      error_message: emailResult.success ? null : emailResult.error,
      resend_email_id: emailResult.success ? emailResult.messageId : null,
    });
    results.push(emailResult.success ? "email sent" : `email failed: ${emailResult.error}`);
  }

  if (smsText && customer.phone) {
    const smsResult = await sendSms({ to: customer.phone, body: smsText });
    await admin.from("reminders").insert({
      location_id: ctx.location.id,
      customer_id: customer.id,
      vehicle_id: null,
      type: "custom",
      channel: "sms",
      recipient_email: null,
      recipient_phone: customer.phone,
      subject,
      message_text: smsText,
      status: smsResult.success ? "sent" : "failed",
      error_message: smsResult.success ? null : smsResult.error,
    });
    results.push(smsResult.success ? "SMS sent" : `SMS failed: ${smsResult.error}`);
  }

  if (whatsappText && customer.phone) {
    const waResult = await sendWhatsApp({ to: customer.phone, body: whatsappText });
    console.log("[sendDraftedMessage] whatsapp send result:", waResult);
    const { error: waInsertErr } = await admin.from("reminders").insert({
      location_id: ctx.location.id,
      customer_id: customer.id,
      vehicle_id: null,
      type: "custom",
      channel: "whatsapp",
      recipient_email: null,
      recipient_phone: customer.phone,
      subject,
      message_text: whatsappText,
      status: waResult.success ? "sent" : "failed",
      error_message: waResult.success ? null : waResult.error,
    });
    if (waInsertErr) console.error("[sendDraftedMessage] whatsapp insert failed:", waInsertErr.message, waInsertErr.code);
    results.push(waResult.success ? "WhatsApp sent" : `WhatsApp failed: ${waResult.error}`);
  }

  if (results.length === 0) return { error: "Nothing to send." };

  const allFailed = results.every((r) => r.includes("failed"));
  if (allFailed) return { error: results.join("; ") };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "message.send",
    entityType: "customer",
    entityId: customerId,
    metadata: { topic, results },
  });

  revalidatePath(`/staff/customers/${customerId}`);
  revalidatePath("/staff/reminders");
  return { success: true, summary: results.join(", ") };
}

// ── Edit / delete ──────────────────────────────────────────────────────────

export type UpdateCustomerResult = { error: string } | { success: true };

export async function updateCustomer(customerId: string, formData: FormData): Promise<UpdateCustomerResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "customers")) return { error: "Permission denied." };

  const fullName = (formData.get("fullName") as string | null)?.trim();
  const email = (formData.get("email") as string | null)?.trim().toLowerCase();
  const phone = (formData.get("phone") as string | null)?.trim();

  if (!fullName) return { error: "Name is required." };
  if (!email) return { error: "Email is required." };
  if (!EMAIL_RE.test(email)) return { error: "Email looks invalid." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("customers")
    .update({ full_name: fullName, email, phone: phone || null })
    .eq("id", customerId)
    .eq("organization_id", ctx.organization.id);

  if (error) {
    if (error.code === "23505") return { error: "A customer with that email already exists." };
    return { error: error.message };
  }

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "customer.update",
    entityType: "customer",
    entityId: customerId,
    metadata: { full_name: fullName, email, phone },
  });

  revalidatePath(`/staff/customers/${customerId}`);
  revalidatePath("/staff/customers");
  return { success: true };
}

export type DeleteCustomerResult = { error: string } | { success: true };

export async function deleteCustomer(customerId: string): Promise<DeleteCustomerResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "customers")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const { error } = await admin
    .from("customers")
    .delete()
    .eq("id", customerId)
    .eq("organization_id", ctx.organization.id);

  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "customer.delete",
    entityType: "customer",
    entityId: customerId,
  });

  revalidatePath("/staff/customers");
  return { success: true };
}

export type UpdateVehicleResult = { error: string } | { success: true };

export async function updateVehicle(vehicleId: string, customerId: string, formData: FormData): Promise<UpdateVehicleResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "customers")) return { error: "Permission denied." };

  const registrationInput = formData.get("registration") as string | null;
  const make = (formData.get("make") as string | null)?.trim() || null;
  const model = (formData.get("model") as string | null)?.trim() || null;
  const yearStr = formData.get("year") as string | null;
  const motExpiry = (formData.get("motExpiry") as string | null) || null;
  const serviceDue = (formData.get("serviceDue") as string | null) || null;
  const taxDueDate = (formData.get("taxDueDate") as string | null) || null;

  const regError = validateRegistration(registrationInput ?? "");
  if (regError) return { error: regError };
  const registration = normalizeRegistration(registrationInput ?? "");

  let year: number | null = null;
  if (yearStr) {
    const parsed = parseInt(yearStr, 10);
    const currentYear = new Date().getFullYear();
    if (Number.isNaN(parsed) || parsed < 1900 || parsed > currentYear + 1) {
      return { error: `Year must be between 1900 and ${currentYear + 1}.` };
    }
    year = parsed;
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("vehicles")
    .update({ registration, make, model, year, mot_expiry: motExpiry, service_due: serviceDue, tax_due_date: taxDueDate })
    .eq("id", vehicleId)
    .eq("organization_id", ctx.organization.id);

  if (error) {
    if (error.code === "23505") return { error: "A vehicle with that registration is already on file." };
    return { error: error.message };
  }

  revalidatePath(`/staff/customers/${customerId}`);
  return { success: true };
}

export type DeleteVehicleResult = { error: string } | { success: true };

export async function deleteVehicle(vehicleId: string, customerId: string): Promise<DeleteVehicleResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "customers")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const { error } = await admin
    .from("vehicles")
    .delete()
    .eq("id", vehicleId)
    .eq("organization_id", ctx.organization.id);

  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "vehicle.delete",
    entityType: "vehicle",
    entityId: vehicleId,
    metadata: { customer_id: customerId },
  });

  revalidatePath(`/staff/customers/${customerId}`);
  return { success: true };
}
