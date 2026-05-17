"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const ROOT = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localtest.me:3000";
const ROOT_HOST = ROOT.split(":")[0];
const PORT = ROOT.includes(":") ? `:${ROOT.split(":")[1]}` : "";
const PROTOCOL =
  ROOT_HOST === "localhost" ||
  ROOT_HOST.endsWith("localtest.me") ||
  ROOT_HOST.endsWith(".local")
    ? "http"
    : "https";

function tenantOrigin(slug: string) {
  return `${PROTOCOL}://${slug}.${ROOT_HOST}${PORT}`;
}

async function findTenantSlugForUser(userId: string): Promise<string | null> {
  const admin = createAdminClient();

  // Org-level membership (owners / admins) — find first location in their org
  const { data: orgMembership } = await admin
    .from("org_users")
    .select("organization_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (orgMembership) {
    const { data: location } = await admin
      .from("locations")
      .select("slug")
      .eq("organization_id", orgMembership.organization_id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (location) return location.slug;
  }

  // Location-level staff membership
  const { data: locMembership } = (await admin
    .from("location_users")
    .select("location:locations(slug)")
    .eq("user_id", userId)
    .maybeSingle()) as {
    data: { location: { slug: string } | null } | null;
  };
  if (locMembership?.location) return locMembership.location.slug;

  return null;
}

// After a successful root-domain sign-in, build a magic-link URL that lands
// on the user's tenant subdomain via /auth/callback — sets the session cookies
// on the subdomain. Plain /staff redirect doesn't work because cookies are
// scoped to the current host.
export async function getStaffTenantUrl(): Promise<
  { url: string } | { error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { error: "Not signed in." };

  const slug = await findTenantSlugForUser(user.id);
  if (!slug) {
    return {
      error: "No garage membership found for this account. Contact your administrator.",
    };
  }

  const redirectTo = `${tenantOrigin(slug)}/auth/callback?next=/staff`;
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: user.email,
    options: { redirectTo },
  });
  if (error || !data.properties?.action_link) {
    return { error: error?.message ?? "Failed to generate cross-domain link." };
  }
  return { url: data.properties.action_link };
}

// Used by passkey login on root domain — same trick.
export async function getStaffTenantMagicLink(
  userId: string,
  email: string,
): Promise<{ url: string } | { error: string }> {
  const slug = await findTenantSlugForUser(userId);
  if (!slug) {
    return { error: "No garage membership found for this account." };
  }
  const redirectTo = `${tenantOrigin(slug)}/auth/callback?next=/staff`;
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo },
  });
  if (error || !data.properties?.action_link) {
    return { error: error?.message ?? "Failed to generate cross-domain link." };
  }
  return { url: data.properties.action_link };
}
