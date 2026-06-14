import { cache } from "react";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { cacheGet, cacheSet, cacheDel } from "@/lib/redis";

const TENANT_TTL_SEC = 60;
const tenantKey = (slug: string) => `tenant:${slug}`;

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
  // Every location in the org (the subdomain now resolves to the ORGANISATION).
  locations: Location[];
  // Back-compat convenience: the org's primary (first) location. Customer-facing
  // branding came off this; org-level branding lives on `organization`. Kept
  // non-null (a tenant with zero locations resolves to null overall).
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

// Deduped per render (React cache) AND cached cross-request in Redis (60s TTL) —
// this branding lookup runs on every tenant page for every visitor. Branding
// edits invalidate the key (invalidateTenantCacheForOrg); a slug change evicts
// both old + new keys. Misses fall through to the DB; negatives are NOT cached
// so a freshly-created tenant appears immediately.
export const getCurrentTenant = cache(async (): Promise<TenantContext | null> => {
  const headersList = await headers();
  const slug = headersList.get("x-tenant-slug");
  if (!slug) return null;

  const cached = await cacheGet<TenantContext>(tenantKey(slug));
  if (cached) return cached;

  // The subdomain resolves to an ORGANISATION. Use the admin client — orgs are
  // publicly selectable but locations are members-only; the branding (name,
  // colour) must be readable by anyone visiting the tenant subdomain pre-login.
  const admin = createAdminClient();
  const { data } = (await admin
    .from("organizations")
    .select(
      "id, slug, name, primary_color, logo_url, custom_domain, primary_location_id, locations:locations!organization_id(id, slug, name)",
    )
    .eq("slug", slug)
    .maybeSingle()) as {
    data: (Organization & { locations: Location[] | null; primary_location_id: string | null }) | null;
  };

  if (!data) return null;
  const locations = (data.locations ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
  if (locations.length === 0) return null;

  const ctx: TenantContext = {
    organization: {
      id: data.id,
      slug: data.slug,
      name: data.name,
      primary_color: data.primary_color,
      logo_url: data.logo_url,
      custom_domain: data.custom_domain,
    },
    locations,
    location: locations.find((l) => l.id === data.primary_location_id) ?? locations[0],
  };
  await cacheSet(tenantKey(slug), ctx, TENANT_TTL_SEC);
  return ctx;
});

// Evict cached branding for the given location slugs (e.g. old + new on a slug
// change). Best-effort; entries also expire by TTL.
export async function invalidateTenantCache(slugs: string[]): Promise<void> {
  await Promise.all(slugs.filter(Boolean).map((s) => cacheDel(tenantKey(s))));
}

// Evict cached branding for every location slug in an org — call after a
// branding edit (name / colour / logo). One light query on a rare write.
export async function invalidateTenantCacheForOrg(organizationId: string): Promise<void> {
  const admin = createAdminClient();
  // The tenant cache is keyed by the ORG slug now; also evict any location slugs
  // for safety during the transition.
  const [{ data: org }, { data: locs }] = await Promise.all([
    admin.from("organizations").select("slug").eq("id", organizationId).maybeSingle(),
    admin.from("locations").select("slug").eq("organization_id", organizationId),
  ]);
  const slugs = [org?.slug as string | undefined, ...((locs ?? []).map((l) => l.slug as string))];
  await invalidateTenantCache(slugs.filter(Boolean) as string[]);
}
