"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  normalizeRegistration,
  validateRegistration,
} from "@/lib/registration";
import { sendEmail } from "@/lib/email";
import {
  draftReminderMessage,
  fallbackReminderMessage,
} from "@/lib/ai-messages";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type AddCustomerResult = { error: string } | { customerId: string };

export async function addCustomer(
  formData: FormData,
): Promise<AddCustomerResult> {
  const ctx = await requireStaffContext();

  const fullName = (formData.get("fullName") as string | null)?.trim();
  const email = (formData.get("email") as string | null)?.trim().toLowerCase();
  const phone = (formData.get("phone") as string | null)?.trim();

  if (!fullName) return { error: "Name is required." };
  if (!email) return { error: "Email is required." };
  if (!EMAIL_RE.test(email)) return { error: "Email looks invalid." };

  const { data, error } = await ctx.supabase
    .from("customers")
    .insert({
      location_id: ctx.location.id,
      full_name: fullName,
      email,
      phone: phone || null,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { error: "A customer with that email already exists." };
    }
    return { error: error.message };
  }

  revalidatePath("/staff/customers");
  return { customerId: data.id };
}

export type AddVehicleResult =
  | { error: string }
  | { vehicleId: string; customerId: string };

export async function addVehicle(
  customerId: string,
  formData: FormData,
): Promise<AddVehicleResult> {
  const ctx = await requireStaffContext();

  const registrationInput = formData.get("registration") as string | null;
  const make = (formData.get("make") as string | null)?.trim() || null;
  const model = (formData.get("model") as string | null)?.trim() || null;
  const yearStr = formData.get("year") as string | null;
  const motExpiry = (formData.get("motExpiry") as string | null) || null;
  const serviceDue = (formData.get("serviceDue") as string | null) || null;

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
    .insert({
      location_id: ctx.location.id,
      customer_id: customerId,
      registration,
      make,
      model,
      year,
      mot_expiry: motExpiry,
      service_due: serviceDue,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { error: "A vehicle with that registration is already on file." };
    }
    return { error: error.message };
  }

  revalidatePath(`/staff/customers/${customerId}`);
  return { vehicleId: data.id, customerId };
}

export type SendReminderResult =
  | { error: string }
  | { success: true; message: string };

export async function sendReminder(
  vehicleId: string,
  reminderType: "mot" | "service",
): Promise<SendReminderResult> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  // Fetch vehicle, customer, and org in parallel
  const [vehicleRes, orgRes] = await Promise.all([
    admin
      .from("vehicles")
      .select(
        "id, registration, make, model, year, mot_expiry, service_due, customer:customers(id, full_name, email)",
      )
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
    customer: { id: string; full_name: string | null; email: string | null } | null;
  };

  const vehicle = vehicleRes.data as VehicleWithCustomer | null;
  const org = orgRes.data;

  if (!vehicle) return { error: "Vehicle not found." };
  if (!vehicle.customer) return { error: "Customer not found." };
  if (!vehicle.customer.email) {
    return { error: "This customer has no email address on file." };
  }

  const dueDate =
    reminderType === "mot" ? vehicle.mot_expiry : vehicle.service_due;
  if (!dueDate) {
    return {
      error: `No ${reminderType === "mot" ? "MOT expiry" : "service due"} date set for this vehicle.`,
    };
  }

  const firstName = vehicle.customer.full_name?.split(" ")[0] ?? "there";
  const vehicleDescription = [vehicle.year, vehicle.make, vehicle.model]
    .filter(Boolean)
    .join(" ");
  const formattedDate = new Date(dueDate).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const draftInput = {
    garageName: org?.name ?? ctx.organization.name,
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

  const subject =
    reminderType === "mot"
      ? `MOT reminder — ${vehicle.registration} due ${formattedDate}`
      : `Service reminder — ${vehicle.registration} due ${formattedDate}`;

  const emailResult = await sendEmail({
    to: vehicle.customer.email,
    subject,
    text: messageText,
  });

  // Log the reminder regardless of send outcome
  await admin.from("reminders").insert({
    location_id: ctx.location.id,
    customer_id: vehicle.customer.id,
    vehicle_id: vehicle.id,
    type: reminderType,
    channel: "email",
    recipient_email: vehicle.customer.email,
    subject,
    message_text: messageText,
    status: emailResult.success ? "sent" : "failed",
    error_message: emailResult.success ? null : emailResult.error,
  });

  if (!emailResult.success) {
    return {
      error: `Message drafted but email failed to send: ${emailResult.error}`,
    };
  }

  revalidatePath(`/staff/customers/${vehicle.customer.id}`);
  revalidatePath("/staff/reminders");
  return { success: true, message: messageText };
}
