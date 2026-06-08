import { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

// Is `slug` free to use as a subdomain? Checks all three reservations:
//   - a current organization slug,
//   - a current location slug,
//   - a retired slug in location_slug_history (permanently reserved).
// Returns a user-facing reason string when taken, else null. Pass excludeOrgId
// / excludeLocationId when re-validating the entity that already owns the slug.
export async function findSlugConflict(
  admin: Admin,
  slug: string,
  opts: { excludeOrgId?: string; excludeLocationId?: string } = {},
): Promise<string | null> {
  const [orgRes, locRes, histRes] = await Promise.all([
    admin.from("organizations").select("id").eq("slug", slug).maybeSingle(),
    admin.from("locations").select("id").eq("slug", slug).maybeSingle(),
    admin.from("location_slug_history").select("old_slug").eq("old_slug", slug).maybeSingle(),
  ]);

  if (locRes.data && locRes.data.id !== opts.excludeLocationId) {
    return "That subdomain is already used by another location.";
  }
  if (orgRes.data && orgRes.data.id !== opts.excludeOrgId) {
    return "That subdomain is taken by another organisation.";
  }
  if (histRes.data) {
    return "That subdomain was used before and is permanently reserved.";
  }
  return null;
}
