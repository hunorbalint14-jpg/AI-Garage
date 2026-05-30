"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-constants";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type RegisterResult = { error: string } | { success: true };

export async function registerCustomer(
  formData: FormData,
): Promise<RegisterResult> {
  const fullName = (formData.get("fullName") as string | null)?.trim();
  const email = (formData.get("email") as string | null)?.trim().toLowerCase();
  const phone = (formData.get("phone") as string | null)?.trim() || null;
  const password = formData.get("password") as string | null;

  if (!fullName) return { error: "Name is required." };
  if (!email || !EMAIL_RE.test(email)) return { error: "A valid email is required." };
  if (!password || password.length < MIN_PASSWORD_LENGTH)
    return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };

  const headersList = await headers();
  const slug = headersList.get("x-tenant-slug");
  if (!slug) return { error: "Could not identify your garage. Please use your garage's URL." };

  const admin = createAdminClient();

  const { data: location } = await admin
    .from("locations")
    .select("id, organization_id")
    .eq("slug", slug)
    .maybeSingle();
  if (!location) return { error: "Garage not found." };

  // Reject if a customer record with that email already exists at this location
  const { data: existingCustomer } = await admin
    .from("customers")
    .select("id")
    .eq("email", email)
    .eq("location_id", location.id)
    .maybeSingle();
  if (existingCustomer) {
    return { error: "An account already exists for this email. Please sign in instead." };
  }

  // Create auth user (auto-confirmed — no email verification needed)
  const { data: userRes, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (userErr || !userRes?.user) {
    return { error: userErr?.message ?? "Failed to create account." };
  }
  const userId = userRes.user.id;

  // Create the customer record linked to this location and auth user
  const { error: customerErr } = await admin.from("customers").insert({
    location_id: location.id,
    user_id: userId,
    full_name: fullName,
    email,
    phone,
  });

  if (customerErr) {
    await admin.auth.admin.deleteUser(userId);
    if (customerErr.code === "23505") {
      return { error: "An account already exists for this email." };
    }
    return { error: customerErr.message };
  }

  return { success: true };
}
