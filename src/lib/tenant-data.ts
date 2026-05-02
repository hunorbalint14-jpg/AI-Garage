import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

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

  const supabase = await createClient();
  const { data } = (await supabase
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
