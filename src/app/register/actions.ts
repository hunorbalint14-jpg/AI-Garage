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

  // The subdomain resolves to the organisation; a customer registers once per
  // org. Pick the home/preferred branch (a later picker can pass locationId).
  const { data: org } = (await admin
    .from("organizations")
    .select("id, locations:locations(id)")
    .eq("slug", slug)
    .maybeSingle()) as { data: { id: string; locations: { id: string }[] | null } | null };
  if (!org || !org.locations || org.locations.length === 0) return { error: "Garage not found." };

  const requestedLocationId = (formData.get("locationId") as string | null) ?? null;
  const homeLocation =
    org.locations.find((l) => l.id === requestedLocationId) ?? org.locations[0];

  // Reject if a customer record with that email already exists in this ORG.
  const { data: existingCustomer } = await admin
    .from("customers")
    .select("id")
    .eq("email", email)
    .eq("organization_id", org.id)
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

  // Create the customer record linked to this org (one per org), with the
  // chosen home branch as preferred_location_id.
  const { error: customerErr } = await admin.from("customers").insert({
    organization_id: org.id,
    preferred_location_id: homeLocation.id,
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
