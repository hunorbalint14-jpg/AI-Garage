import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export type Garage = {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  primary_color: string;
  custom_domain: string | null;
};

export async function getCurrentTenant(): Promise<Garage | null> {
  const headersList = await headers();
  const slug = headersList.get("x-tenant-slug");
  if (!slug) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("garages")
    .select("id, slug, name, logo_url, primary_color, custom_domain")
    .eq("slug", slug)
    .maybeSingle();

  return data;
}
