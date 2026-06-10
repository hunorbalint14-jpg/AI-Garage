import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTenantFromHost } from "@/lib/tenant";
import { type Permissions, normalisePermissions } from "@/app/staff/staff-members/constants";
import { type OrgBilling } from "@/lib/tenant-plans";
import { isPlatformAdminUser } from "@/lib/platform-admin";
import { cacheGet, cacheSet, cacheDel } from "@/lib/redis";

// Cross-request Redis cache for the two lookups every staff request repeats:
// the location+org row (by slug) and the user's membership (by user+location).
// 60s TTL bounds staleness; the mutation paths below also evict eagerly —
// staff-members actions call invalidateStaffMembershipCache*, branding/slug
// edits call invalidateStaffLocationCache*. Worst case a revoked member keeps
// a permission snapshot for 60s on a code path that missed an eviction.
const STAFF_CACHE_TTL_SEC = 60;
const locationKey = (slug: string) => `staffloc:${slug}`;
const membershipKey = (userId: string, locationId: string) => `staffmem:${userId}:${locationId}`;

type StaffMembership = {
  orgRole: "owner" | "admin" | null;
  locRow: {
    role: string;
    permissions: Partial<Permissions> | null;
    mot_tester: boolean | null;
    mot_qc_reviewer: boolean | null;
  } | null;
};

// Evict a user's cached membership at one location — call after granting,
// changing, or revoking access so the change takes effect immediately.
export async function invalidateStaffMembershipCache(
  userId: string,
  locationId: string,
): Promise<void> {
  await cacheDel(membershipKey(userId, locationId));
}

// Org-scoped variant: org_users rows grant access at every location in the
// org, so evict the user's membership at all of them.
export async function invalidateStaffMembershipCacheForOrg(
  userId: string,
  organizationId: string,
): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin.from("locations").select("id").eq("organization_id", organizationId);
  await Promise.all(((data ?? []) as { id: string }[]).map((l) => cacheDel(membershipKey(userId, l.id))));
}

// Evict cached location+org rows — call alongside invalidateTenantCache when
// branding / billing / slug / DPA fields on the org or location change.
export async function invalidateStaffLocationCache(slugs: string[]): Promise<void> {
  await Promise.all(slugs.filter(Boolean).map((s) => cacheDel(locationKey(s))));
}

export async function invalidateStaffLocationCacheForOrg(organizationId: string): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin.from("locations").select("slug").eq("organization_id", organizationId);
  await invalidateStaffLocationCache(((data ?? []) as { slug: string }[]).map((l) => l.slug));
}

export type StaffContext = {
  user: { id: string; email: string | undefined; fullName: string | null };
  organization: { id: string; slug: string; name: string };
  location: { id: string; slug: string; name: string };
  // Branding + DPA version for the staff shell (saves the layout a second org
  // query — it's all on the same row we already fetch here).
  branding: { primaryColor: string | null; logoUrl: string | null; dpaVersion: string | null };
  // Org-level SaaS billing snapshot (tier + status) for tenant feature gating.
  tenantBilling: OrgBilling;
  // Org-level role gives access across all locations in the org. Null if the
  // user only has direct location membership.
  orgRole: "owner" | "admin" | null;
  // Location-level role for non-org-member staff at this specific location.
  // Null if the user is accessing via org-level membership.
  locationRole: string | null;
  // Permission snapshot for the current location. Null if accessing via
  // orgRole (owners/admins bypass perm checks).
  locationPermissions: Permissions | null;
  motTester: boolean;
  motQcReviewer: boolean;
  supabase: Awaited<ReturnType<typeof createClient>>;
};

export const getStaffContext = cache(async (): Promise<StaffContext | null> => {
  const supabase = await createClient();

  // Local JWT (JWKS) verification — no Auth network round-trip. We only need
  // id / email / full_name, all of which are standard claims. The supabase
  // client is still returned for callers' RLS-scoped queries.
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims?.sub) return null;
  const user = {
    id: claims.sub,
    email: claims.email,
    user_metadata: claims.user_metadata as { full_name?: string } | undefined,
  };

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
      primary_color: string | null;
      logo_url: string | null;
      dpa_version: string | null;
      tenant_plan: string | null;
      tenant_subscription_status: string | null;
      tenant_current_period_end: string | null;
      tenant_trial_end: string | null;
    } | null;
  };

  // Use the admin client for the location lookup so RLS doesn't filter the
  // row before we've had a chance to verify the user's membership ourselves.
  // Location slugs are not sensitive — we check membership explicitly below.
  // Cached by slug; negatives are NOT cached so new tenants appear instantly.
  const admin = createAdminClient();
  let location = await cacheGet<LocationWithOrg>(locationKey(slug));
  if (!location) {
    const { data } = (await admin
      .from("locations")
      .select(
        "id, slug, name, organization_id, organization:organizations(id, slug, name, primary_color, logo_url, dpa_version, tenant_plan, tenant_subscription_status, tenant_current_period_end, tenant_trial_end)",
      )
      .eq("slug", slug)
      .maybeSingle()) as { data: LocationWithOrg | null };
    if (data?.organization) {
      await cacheSet(locationKey(slug), data, STAFF_CACHE_TTL_SEC);
    }
    location = data;
  }

  if (!location || !location.organization) return null;

  // Membership pair cached as one value — negatives included (a non-member
  // probing staff URLs shouldn't cost two queries per hit); the staff-members
  // mutation actions evict on grant/change/revoke.
  let membership = await cacheGet<StaffMembership>(membershipKey(user.id, location.id));
  if (!membership) {
    const [orgMembershipRes, locMembershipRes] = await Promise.all([
      admin
        .from("org_users")
        .select("role")
        .eq("user_id", user.id)
        .eq("organization_id", location.organization.id)
        .maybeSingle(),
      admin
        .from("location_users")
        .select("role, permissions, mot_tester, mot_qc_reviewer")
        .eq("user_id", user.id)
        .eq("location_id", location.id)
        .maybeSingle(),
    ]);
    membership = {
      orgRole: (orgMembershipRes.data?.role as "owner" | "admin" | undefined) ?? null,
      locRow: (locMembershipRes.data as StaffMembership["locRow"]) ?? null,
    };
    await cacheSet(membershipKey(user.id, location.id), membership, STAFF_CACHE_TTL_SEC);
  }

  const orgRole = membership.orgRole;
  const locRow = membership.locRow;
  const locationRole = locRow?.role ?? null;

  // Platform admins (invited operators) act as an owner inside EVERY tenant's
  // portal — no membership row required. Only checked when normal membership is
  // absent, so it never adds a query for ordinary staff. The DB mirror of this
  // (is_platform_admin() in the RLS helpers) is what actually permits the rows.
  const isPlatform =
    !orgRole && !locationRole
      ? await isPlatformAdminUser({ id: user.id, email: user.email ?? null })
      : false;

  if (!orgRole && !locationRole && !isPlatform) return null;

  const effectiveOrgRole: "owner" | "admin" | null = orgRole ?? (isPlatform ? "owner" : null);
  // Org-level access (owner/admin) bypasses perm checks, surface null to
  // signal that. Otherwise normalise to fill missing keys defensively.
  const locationPermissions = effectiveOrgRole ? null : locRow ? normalisePermissions(locRow.permissions) : null;
  const motTester = locRow?.mot_tester === true;
  const motQcReviewer = locRow?.mot_qc_reviewer === true;

  return {
    user: {
      id: user.id,
      email: user.email,
      fullName:
        (user.user_metadata?.full_name as string | undefined) ?? null,
    },
    organization: location.organization,
    location: { id: location.id, slug: location.slug, name: location.name },
    branding: {
      primaryColor: location.organization.primary_color,
      logoUrl: location.organization.logo_url,
      dpaVersion: location.organization.dpa_version,
    },
    tenantBilling: {
      tenant_plan: location.organization.tenant_plan,
      tenant_subscription_status: location.organization.tenant_subscription_status,
      tenant_current_period_end: location.organization.tenant_current_period_end,
      tenant_trial_end: location.organization.tenant_trial_end,
    },
    orgRole: effectiveOrgRole,
    locationRole,
    locationPermissions,
    motTester,
    motQcReviewer,
    supabase,
  };
});

export async function requireStaffContext(): Promise<StaffContext> {
  const ctx = await getStaffContext();
  if (!ctx) redirect("/staff/login");
  return ctx;
}
