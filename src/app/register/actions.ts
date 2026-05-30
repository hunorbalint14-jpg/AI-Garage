"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailSchema, nameSchema, phoneSchema, passwordSchema, parseOrError } from "@/lib/validation";
import { z } from "zod";

const registerSchema = z.object({
  fullName: nameSchema,
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
});

export type RegisterResult = { error: string } | { success: true };

export async function registerCustomer(
  formData: FormData,
): Promise<RegisterResult> {
  const parsed = parseOrError(registerSchema, {
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    phone: formData.get("phone") ?? undefined,
    password: formData.get("password"),
  });
  if ("error" in parsed) return parsed;
  const { fullName, email, phone, password } = parsed.data;

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
    phone: phone ?? null,
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
