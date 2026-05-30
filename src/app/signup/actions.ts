"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { validateSlug } from "@/lib/slug";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-constants";

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
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (!slugInput) return { error: "Subdomain is required." };

  const slugError = validateSlug(slugInput);
  if (slugError) return { error: slugError };

  const admin = createAdminClient();

  // The slug is unique on both organizations and locations. Reject early if
  // either is taken so we surface a clean error before creating an auth user.
  const [{ data: existingOrg }, { data: existingLoc }] = await Promise.all([
    admin.from("organizations").select("id").eq("slug", slugInput).maybeSingle(),
    admin.from("locations").select("id").eq("slug", slugInput).maybeSingle(),
  ]);
  if (existingOrg || existingLoc) {
    return { error: "That subdomain is already taken." };
  }

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

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ slug: slugInput, name: businessName })
    .select("id")
    .single();
  if (orgErr || !org) {
    await admin.auth.admin.deleteUser(userId);
    return { error: orgErr?.message ?? "Failed to create organization." };
  }

  // First location uses the same slug as the org. Multi-location chains will
  // pick distinct slugs for additional branches via the (future) add-location flow.
  const { data: location, error: locErr } = await admin
    .from("locations")
    .insert({
      organization_id: org.id,
      slug: slugInput,
      name: businessName,
    })
    .select("id")
    .single();
  if (locErr || !location) {
    await admin.from("organizations").delete().eq("id", org.id);
    await admin.auth.admin.deleteUser(userId);
    return { error: locErr?.message ?? "Failed to create location." };
  }

  const { error: linkErr } = await admin.from("org_users").insert({
    user_id: userId,
    organization_id: org.id,
    role: "owner",
  });
  if (linkErr) {
    await admin.from("locations").delete().eq("id", location.id);
    await admin.from("organizations").delete().eq("id", org.id);
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
