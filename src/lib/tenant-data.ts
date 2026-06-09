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

  const ctx: TenantContext = {
    organization: data.organization,
    location: { id: data.id, slug: data.slug, name: data.name },
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
  const { data } = await admin.from("locations").select("slug").eq("organization_id", organizationId);
  await invalidateTenantCache((data ?? []).map((l) => l.slug as string));
}
