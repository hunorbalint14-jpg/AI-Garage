import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTenantFromHost } from "@/lib/tenant";

export type StaffContext = {
  user: { id: string; email: string | undefined; fullName: string | null };
  organization: { id: string; slug: string; name: string };
  location: { id: string; slug: string; name: string };
  // Org-level role gives access across all locations in the org. Null if the
  // user only has direct location membership.
  orgRole: "owner" | "admin" | null;
  // Location-level role for non-org-member staff at this specific location.
  // Null if the user is accessing via org-level membership.
  locationRole: string | null;
  supabase: Awaited<ReturnType<typeof createClient>>;
};

export const getStaffContext = cache(async (): Promise<StaffContext | null> => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const headersList = await headers();
  const slug =
    headersList.get("x-tenant-slug") ??
    resolveTenantFromHost(
      headersList.get("host") ?? headersList.get("x-forwarded-host") ?? "",
    ).slug;
  if (!slug) return null;

  type LocationWithOrg = {
    id: string;
    slug: string;
    name: string;
    organization_id: string;
    organization: {
      id: string;
      slug: string;
      name: string;
    } | null;
  };

  // Use the admin client for the location lookup so RLS doesn't filter the
  // row before we've had a chance to verify the user's membership ourselves.
  // Location slugs are not sensitive — we check membership explicitly below.
  const admin = createAdminClient();
  const { data: location } = (await admin
    .from("locations")
    .select(
      "id, slug, name, organization_id, organization:organizations(id, slug, name)",
    )
    .eq("slug", slug)
    .maybeSingle()) as { data: LocationWithOrg | null };

  if (!location || !location.organization) return null;

  const [orgMembershipRes, locMembershipRes] = await Promise.all([
    admin
      .from("org_users")
      .select("role")
      .eq("user_id", user.id)
      .eq("organization_id", location.organization.id)
      .maybeSingle(),
    admin
      .from("location_users")
      .select("role")
      .eq("user_id", user.id)
      .eq("location_id", location.id)
      .maybeSingle(),
  ]);

  const orgRole = (orgMembershipRes.data?.role as
    | "owner"
    | "admin"
    | undefined) ?? null;
  const locationRole = (locMembershipRes.data?.role as string | undefined) ?? null;

  if (!orgRole && !locationRole) return null;

  return {
    user: {
      id: user.id,
      email: user.email,
      fullName:
        (user.user_metadata?.full_name as string | undefined) ?? null,
    },
    organization: location.organization,
    location: { id: location.id, slug: location.slug, name: location.name },
    orgRole,
    locationRole,
    supabase,
  };
});

export async function requireStaffContext(): Promise<StaffContext> {
  const ctx = await getStaffContext();
  if (!ctx) redirect("/staff/login");
  return ctx;
}
