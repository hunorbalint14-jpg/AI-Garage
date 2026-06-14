import { cache } from "react";
import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTenantFromHost } from "@/lib/tenant";
import { type Permissions, normalisePermissions } from "@/app/staff/staff-members/constants";
import { type OrgBilling } from "@/lib/tenant-plans";
import { isPlatformAdminUser } from "@/lib/platform-admin";
import { cacheGet, cacheSet, cacheDel } from "@/lib/redis";

// The subdomain resolves to an ORGANISATION. A staff member sees the whole org
// (all customers, vehicles, plans, comms) but operational work (jobs, bookings)
// is scoped to the ACTIVE LOCATION — the branch they're currently viewing, held
// in the `active_location` cookie and switched via setActiveLocation(). Org
// owners/admins/accountants can act in any branch; location-only staff are
// limited to the branches they have a location_users row for.

// Cookie holding the active branch (a location id). Never trusted on its own —
// getStaffContext re-checks it against the user's accessible locations.
export const ACTIVE_LOCATION_COOKIE = "active_location";

// Cross-request Redis cache for the two lookups every staff request repeats:
// the org row (by slug) and the user's membership (by user+org). 60s TTL bounds
// staleness; the mutation paths below also evict eagerly.
const STAFF_CACHE_TTL_SEC = 60;
const orgKey = (slug: string) => `stafforg:${slug}`;
const membershipKey = (userId: string, orgId: string) => `staffmem:${userId}:${orgId}`;

type StaffLocation = { id: string; slug: string; name: string };

type StaffMembership = {
  orgRole: "owner" | "admin" | "accountant" | null;
  // Every location_users row this user holds in the org, keyed by location id.
  locRows: Record<
    string,
    {
      role: string;
      permissions: Partial<Permissions> | null;
      mot_tester: boolean | null;
      mot_qc_reviewer: boolean | null;
    }
  >;
};

// Evict a user's cached membership at one location — call after granting,
// changing, or revoking access so the change takes effect immediately. The
// membership snapshot is org-keyed, so resolve the location's org first.
export async function invalidateStaffMembershipCache(
  userId: string,
  locationId: string,
): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("locations")
    .select("organization_id")
    .eq("id", locationId)
    .maybeSingle();
  const orgId = (data as { organization_id: string } | null)?.organization_id;
  if (orgId) await cacheDel(membershipKey(userId, orgId));
}

// Org-scoped variant: evict the user's org membership snapshot directly.
export async function invalidateStaffMembershipCacheForOrg(
  userId: string,
  organizationId: string,
): Promise<void> {
  await cacheDel(membershipKey(userId, organizationId));
}

// Evict cached org rows — call alongside invalidateTenantCache when branding /
// billing / slug / DPA fields on the org change. Accepts org slugs.
export async function invalidateStaffLocationCache(slugs: string[]): Promise<void> {
  await Promise.all(slugs.filter(Boolean).map((s) => cacheDel(orgKey(s))));
}

export async function invalidateStaffLocationCacheForOrg(organizationId: string): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("organizations")
    .select("slug")
    .eq("id", organizationId)
    .maybeSingle();
  const slug = (data as { slug: string } | null)?.slug;
  if (slug) await invalidateStaffLocationCache([slug]);
}

export type StaffContext = {
  user: { id: string; email: string | undefined; fullName: string | null };
  organization: { id: string; slug: string; name: string };
  // The active branch (operational scope). Defaults to the first accessible
  // location when no valid cookie is set. Kept non-null so the many
  // `ctx.location.id` operational call sites stay correct.
  location: StaffLocation;
  activeLocation: StaffLocation;
  // Every branch this user may act in (org owners/admins/accountants: all;
  // location staff: only their rows). Drives the top-bar switcher.
  accessibleLocations: StaffLocation[];
  branding: { primaryColor: string | null; logoUrl: string | null; dpaVersion: string | null };
  tenantBilling: OrgBilling;
  // Org-level role grants access across all locations. 'accountant' is global
  // finance read-only with NO operational reach. Null = location-only staff.
  orgRole: "owner" | "admin" | "accountant" | null;
  // Location-level role for the active branch (null when accessing via orgRole).
  locationRole: string | null;
  locationPermissions: Permissions | null;
  motTester: boolean;
  motQcReviewer: boolean;
  supabase: Awaited<ReturnType<typeof createClient>>;
};

type OrgWithLocations = {
  id: string;
  slug: string;
  name: string;
  primary_color: string | null;
  logo_url: string | null;
  dpa_version: string | null;
  tenant_plan: string | null;
  tenant_subscription_status: string | null;
  tenant_current_period_end: string | null;
  tenant_trial_end: string | null;
  locations: StaffLocation[];
};

export const getStaffContext = cache(async (): Promise<StaffContext | null> => {
  const supabase = await createClient();

  // Local JWT (JWKS) verification — no Auth network round-trip.
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims?.sub) return null;
  const user = {
    id: claims.sub,
    email: claims.email as string | undefined,
    user_metadata: claims.user_metadata as { full_name?: string } | undefined,
  };

  const headersList = await headers();
  const slug =
    headersList.get("x-tenant-slug") ??
    resolveTenantFromHost(
      headersList.get("host") ?? headersList.get("x-forwarded-host") ?? "",
    ).slug;
  if (!slug) return null;

  // Org row (+ its locations) cached by slug; negatives are NOT cached so new
  // tenants appear instantly. Admin client so RLS doesn't pre-filter.
  const admin = createAdminClient();
  let org = await cacheGet<OrgWithLocations>(orgKey(slug));
  if (!org) {
    const { data } = (await admin
      .from("organizations")
      .select(
        "id, slug, name, primary_color, logo_url, dpa_version, tenant_plan, tenant_subscription_status, tenant_current_period_end, tenant_trial_end, locations:locations(id, slug, name)",
      )
      .eq("slug", slug)
      .maybeSingle()) as { data: OrgWithLocations | null };
    if (data) {
      data.locations = (data.locations ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
      await cacheSet(orgKey(slug), data, STAFF_CACHE_TTL_SEC);
    }
    org = data;
  }
  if (!org || org.locations.length === 0) return null;
  const orgLocationIds = org.locations.map((l) => l.id);

  // Membership snapshot (org role + all location rows in this org), cached per
  // (user, org). Negatives included so non-members don't cost queries per hit.
  let membership = await cacheGet<StaffMembership>(membershipKey(user.id, org.id));
  if (!membership) {
    const [orgRes, locRes] = await Promise.all([
      admin
        .from("org_users")
        .select("role")
        .eq("user_id", user.id)
        .eq("organization_id", org.id)
        .maybeSingle(),
      admin
        .from("location_users")
        .select("location_id, role, permissions, mot_tester, mot_qc_reviewer")
        .eq("user_id", user.id)
        .in("location_id", orgLocationIds),
    ]);
    const locRows: StaffMembership["locRows"] = {};
    for (const row of (locRes.data ?? []) as Array<{
      location_id: string;
      role: string;
      permissions: Partial<Permissions> | null;
      mot_tester: boolean | null;
      mot_qc_reviewer: boolean | null;
    }>) {
      locRows[row.location_id] = {
        role: row.role,
        permissions: row.permissions,
        mot_tester: row.mot_tester,
        mot_qc_reviewer: row.mot_qc_reviewer,
      };
    }
    membership = {
      orgRole: (orgRes.data?.role as StaffMembership["orgRole"]) ?? null,
      locRows,
    };
    await cacheSet(membershipKey(user.id, org.id), membership, STAFF_CACHE_TTL_SEC);
  }

  // Platform admins act as owner in every tenant — only checked when no normal
  // membership exists, so it never adds a query for ordinary staff.
  const hasLocationRow = Object.keys(membership.locRows).length > 0;
  const isPlatform =
    !membership.orgRole && !hasLocationRow
      ? await isPlatformAdminUser({ id: user.id, email: user.email ?? null })
      : false;

  if (!membership.orgRole && !hasLocationRow && !isPlatform) return null;

  const orgRole: StaffContext["orgRole"] = membership.orgRole ?? (isPlatform ? "owner" : null);

  // Org roles + platform admins can act in any branch; location-only staff are
  // limited to the branches they hold a row for.
  const accessibleLocations =
    orgRole || isPlatform
      ? org.locations
      : org.locations.filter((l) => membership!.locRows[l.id]);
  if (accessibleLocations.length === 0) return null;

  // Active branch: the cookie if it points at an accessible location, else the
  // first accessible one.
  const cookieStore = await cookies();
  const cookieLoc = cookieStore.get(ACTIVE_LOCATION_COOKIE)?.value;
  const activeLocation =
    accessibleLocations.find((l) => l.id === cookieLoc) ?? accessibleLocations[0];

  const activeLocRow = membership.locRows[activeLocation.id] ?? null;
  // Org-level access bypasses per-location permission checks (null signals that).
  const locationPermissions = orgRole
    ? null
    : activeLocRow
      ? normalisePermissions(activeLocRow.permissions)
      : null;

  return {
    user: {
      id: user.id,
      email: user.email,
      fullName: (user.user_metadata?.full_name as string | undefined) ?? null,
    },
    organization: { id: org.id, slug: org.slug, name: org.name },
    location: activeLocation,
    activeLocation,
    accessibleLocations,
    branding: {
      primaryColor: org.primary_color,
      logoUrl: org.logo_url,
      dpaVersion: org.dpa_version,
    },
    tenantBilling: {
      tenant_plan: org.tenant_plan,
      tenant_subscription_status: org.tenant_subscription_status,
      tenant_current_period_end: org.tenant_current_period_end,
      tenant_trial_end: org.tenant_trial_end,
    },
    orgRole,
    locationRole: orgRole ? null : activeLocRow?.role ?? null,
    locationPermissions,
    motTester: activeLocRow?.mot_tester === true,
    motQcReviewer: activeLocRow?.mot_qc_reviewer === true,
    supabase,
  };
});

export async function requireStaffContext(): Promise<StaffContext> {
  const ctx = await getStaffContext();
  if (!ctx) redirect("/staff/login");
  return ctx;
}
