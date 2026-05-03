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
