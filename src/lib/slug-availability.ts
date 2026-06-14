import { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

// Is `slug` free to use as a subdomain? The subdomain is the ORGANISATION slug,
// so this checks both reservations:
//   - a current organization slug,
//   - a retired slug in org_slug_history (permanently reserved).
// (Location slugs are internal branch identifiers now, not subdomains.)
// Returns a user-facing reason string when taken, else null. Pass excludeOrgId
// when re-validating the org that already owns the slug.
export async function findSlugConflict(
  admin: Admin,
  slug: string,
  opts: { excludeOrgId?: string } = {},
): Promise<string | null> {
  const [orgRes, histRes] = await Promise.all([
    admin.from("organizations").select("id").eq("slug", slug).maybeSingle(),
    admin.from("org_slug_history").select("old_slug").eq("old_slug", slug).maybeSingle(),
  ]);

  if (orgRes.data && orgRes.data.id !== opts.excludeOrgId) {
    return "That subdomain is taken by another organisation.";
  }
  if (histRes.data) {
    return "That subdomain was used before and is permanently reserved.";
  }
  return null;
}
