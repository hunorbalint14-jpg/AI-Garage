"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { validateSlug } from "@/lib/slug";

export type SignupResult = { error: string } | { redirectUrl: string };

export async function signUpGarage(formData: FormData): Promise<SignupResult> {
  const businessName = (formData.get("businessName") as string | null)?.trim();
  const slugInput = (formData.get("slug") as string | null)?.trim().toLowerCase();
  const ownerName = (formData.get("ownerName") as string | null)?.trim();
  const email = (formData.get("email") as string | null)?.trim().toLowerCase();
  const password = formData.get("password") as string | null;

  if (!businessName) return { error: "Business name is required." };
  if (!ownerName) return { error: "Your name is required." };
  if (!email) return { error: "Email is required." };
  if (!password || password.length < 6) {
    return { error: "Password must be at least 6 characters." };
  }
  if (!slugInput) return { error: "Subdomain is required." };

  const slugError = validateSlug(slugInput);
  if (slugError) return { error: slugError };

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("garages")
    .select("id")
    .eq("slug", slugInput)
    .maybeSingle();
  if (existing) return { error: "That subdomain is already taken." };

  const { data: userRes, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: ownerName },
  });
  if (userErr || !userRes?.user) {
    return { error: userErr?.message ?? "Failed to create user." };
  }
  const userId = userRes.user.id;

  const { data: garage, error: garageErr } = await admin
    .from("garages")
    .insert({ slug: slugInput, name: businessName })
    .select("id")
    .single();
  if (garageErr || !garage) {
    await admin.auth.admin.deleteUser(userId);
    return { error: garageErr?.message ?? "Failed to create garage." };
  }

  const { error: linkErr } = await admin.from("garage_users").insert({
    user_id: userId,
    garage_id: garage.id,
    role: "owner",
  });
  if (linkErr) {
    await admin.from("garages").delete().eq("id", garage.id);
    await admin.auth.admin.deleteUser(userId);
    return { error: linkErr.message };
  }

  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localtest.me:3000";
  const hostname = rootDomain.split(":")[0];
  const isLocal =
    hostname === "localtest.me" ||
    hostname.endsWith(".local") ||
    hostname === "localhost";
  const protocol = isLocal ? "http" : "https";
  const redirectUrl = `${protocol}://${slugInput}.${rootDomain}/staff/login?email=${encodeURIComponent(email)}`;

  return { redirectUrl };
}
