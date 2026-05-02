"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import {
  normalizeRegistration,
  validateRegistration,
} from "@/lib/registration";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type AddCustomerResult =
  | { error: string }
  | { customerId: string };

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
      garage_id: ctx.membership.garage_id,
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

  // Verify customer belongs to this garage (RLS would block otherwise, but we
  // want a clear error rather than a confusing insert failure).
  const { data: customer } = await ctx.supabase
    .from("customers")
    .select("id")
    .eq("id", customerId)
    .maybeSingle();
  if (!customer) return { error: "Customer not found." };

  const { data, error } = await ctx.supabase
    .from("vehicles")
    .insert({
      garage_id: ctx.membership.garage_id,
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
