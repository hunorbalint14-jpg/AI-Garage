import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

export type Organization = {
  id: string;
  slug: string;
  name: string;
  primary_color: string;
  logo_url: string | null;
  custom_domain: string | null;
};

export type Location = {
  id: string;
  slug: string;
  name: string;
};

export type TenantContext = {
  organization: Organization;
  location: Location;
};

/**
 * Given an authenticated user's ID, determines which portal they belong to
 * and resolves their organization ID from the current tenant context.
 *
 * Returns `portal: "staff"` when the user has an org_users or location_users
 * membership row; `portal: "customer"` otherwise. `organizationId` is the
 * organization from the current subdomain, or null if on the root domain.
 */
export async function resolvePortalForUser(
  userId: string,
): Promise<{ portal: "staff" | "customer"; organizationId: string | null }> {
  const tenant = await getCurrentTenant();
  const organizationId = tenant?.organization.id ?? null;

  if (!organizationId) {
    // Root domain — default to staff (passkey / magic-link handoff flows)
    return { portal: "staff", organizationId: null };
  }

  const admin = createAdminClient();
  const { data: location } = await admin
    .from("locations")
    .select("id")
    .eq("organization_id", organizationId)
    .limit(1)
    .maybeSingle();

  if (!location) return { portal: "customer", organizationId };

  const [orgCheck, locCheck] = await Promise.all([
    admin
      .from("org_users")
      .select("id")
      .eq("user_id", userId)
      .eq("organization_id", organizationId)
      .maybeSingle(),
    admin
      .from("location_users")
      .select("id")
      .eq("user_id", userId)
      .eq("location_id", location.id)
      .maybeSingle(),
  ]);

  if (orgCheck.data || locCheck.data) {
    return { portal: "staff", organizationId };
  }
  return { portal: "customer", organizationId };
}

export async function getCurrentTenant(): Promise<TenantContext | null> {
  const headersList = await headers();
  const slug = headersList.get("x-tenant-slug");
  if (!slug) return null;

  // Use admin client — locations have a members-only RLS policy but the
  // branding data (name, colour) must be readable by anyone visiting the
  // tenant subdomain before they are logged in.
  const admin = createAdminClient();
  const { data } = (await admin
    .from("locations")
    .select(
      "id, slug, name, organization:organizations(id, slug, name, primary_color, logo_url, custom_domain)",
    )
    .eq("slug", slug)
    .maybeSingle()) as {
    data: {
      id: string;
      slug: string;
      name: string;
      organization: Organization | null;
    } | null;
  };

  if (!data || !data.organization) return null;

  return {
    organization: data.organization,
    location: { id: data.id, slug: data.slug, name: data.name },
  };
}
