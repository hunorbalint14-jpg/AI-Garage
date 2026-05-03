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

function tenantUrl(slug: string) {
  return `${PROTOCOL}://${slug}.${ROOT_HOST}${PORT}/staff`;
}

// After a successful signInWithPassword on the root domain, call this to
// find which tenant subdomain the staff member belongs to and get the URL.
export async function getStaffTenantUrl(): Promise<
  { url: string } | { error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const admin = createAdminClient();

  // Org-level membership (owners / admins) — find first location in their org
  const { data: orgMembership } = await admin
    .from("org_users")
    .select("organization_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (orgMembership) {
    const { data: location } = await admin
      .from("locations")
      .select("slug")
      .eq("organization_id", orgMembership.organization_id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (location) return { url: tenantUrl(location.slug) };
  }

  // Location-level staff membership
  const { data: locMembership } = (await admin
    .from("location_users")
    .select("location:locations(slug)")
    .eq("user_id", user.id)
    .maybeSingle()) as {
    data: { location: { slug: string } | null } | null;
  };

  if (locMembership?.location) {
    return { url: tenantUrl(locMembership.location.slug) };
  }

  return {
    error:
      "No garage membership found for this account. Contact your administrator.",
  };
}
