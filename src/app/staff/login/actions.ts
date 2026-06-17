"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enforceRateLimit, tooManyAttemptsError } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { getCurrentTenant } from "@/lib/tenant-data";

const ROOT =
  process.env.ROOT_DOMAIN ??
  process.env.NEXT_PUBLIC_ROOT_DOMAIN ??
  "localtest.me:3000";
const ROOT_HOST = ROOT.split(":")[0];
const PORT = ROOT.includes(":") ? `:${ROOT.split(":")[1]}` : "";
const PROTOCOL =
  ROOT_HOST === "localhost" ||
  ROOT_HOST.endsWith("localtest.me") ||
  ROOT_HOST.endsWith(".local")
    ? "http"
    : "https";

function tenantOrigin(slug: string) {
  return `${PROTOCOL}://${slug}.${ROOT_HOST}${PORT}`;
}

async function findTenantSlugForUser(userId: string): Promise<string | null> {
  const admin = createAdminClient();

  // Org-level membership (owners / admins) — find first location in their org
  const { data: orgMembership } = await admin
    .from("org_users")
    .select("organization_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (orgMembership) {
    const { data: location } = await admin
      .from("locations")
      .select("slug")
      .eq("organization_id", orgMembership.organization_id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (location) return location.slug;
  }

  // Location-level staff membership
  const { data: locMembership } = (await admin
    .from("location_users")
    .select("location:locations(slug)")
    .eq("user_id", userId)
    .maybeSingle()) as {
    data: { location: { slug: string } | null } | null;
  };
  if (locMembership?.location) return locMembership.location.slug;

  return null;
}

function handoffUrl(slug: string, tokenHash: string, next: string): string {
  return `${tenantOrigin(slug)}/auth/handoff?token_hash=${encodeURIComponent(tokenHash)}&next=${encodeURIComponent(next)}`;
}

// Server-side staff password sign-in. Runs through the rate limiter (per
// IP+email) before touching Supabase, so brute-force / credential-stuffing is
// throttled — which a client-side signInWithPassword could not enforce. On the
// root marketing domain it returns a cross-subdomain handoff URL; on a tenant
// subdomain it returns "/staff".
export async function signInStaff(
  email: string,
  password: string,
): Promise<{ url: string } | { error: string }> {
  const limited = await enforceRateLimit("login", email);
  if (!limited.ok) return tooManyAttemptsError(limited.retryAfter);

  const supabase = await createClient();
  const [{ error }, tenant] = await Promise.all([
    supabase.auth.signInWithPassword({ email, password }),
    getCurrentTenant(),
  ]);
  const organizationId = tenant?.organization.id ?? null;

  if (error) {
    await logAudit({
      action: "auth.login_failed",
      actorUserId: null,
      actorEmail: email,
      organizationId,
      metadata: { method: "password", portal: "staff", reason: error.message },
    });
    return { error: error.message };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  await logAudit({
    action: "auth.login",
    actorUserId: user?.id ?? null,
    actorEmail: user?.email ?? email,
    organizationId,
    metadata: { method: "password", portal: "staff" },
  });

  const headersList = await headers();
  const hostname = (headersList.get("host") ?? "").split(":")[0];
  const isRootDomain = hostname === ROOT_HOST || hostname === `www.${ROOT_HOST}`;
  // Land on the branch chooser; it forwards straight to /staff for single-branch
  // users / orgs.
  if (!isRootDomain) return { url: "/staff/select-branch" };

  // Root domain — mint a handoff link to the user's tenant subdomain.
  // (The handoff itself is only a cross-domain session transfer, not a new
  // login — we already logged auth.login above.)
  if (!user?.email) return { error: "Not signed in." };

  const slug = await findTenantSlugForUser(user.id);
  if (!slug) {
    return {
      error: "No garage membership found for this account. Contact your administrator.",
    };
  }

  const admin = createAdminClient();
  const { data, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: user.email,
  });
  const tokenHash = data?.properties?.hashed_token;
  if (linkErr || !tokenHash) {
    return { error: linkErr?.message ?? "Failed to generate handoff token." };
  }
  return { url: handoffUrl(slug, tokenHash, "/staff/select-branch") };
}

// Used by passkey login on root domain — same trick.
export async function getStaffTenantMagicLink(
  _userId: string,
  email: string,
): Promise<{ url: string } | { error: string }> {
  const slug = await findTenantSlugForUser(_userId);
  if (!slug) {
    return { error: "No garage membership found for this account." };
  }
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    return { error: error?.message ?? "Failed to generate handoff token." };
  }
  return { url: handoffUrl(slug, tokenHash, "/staff/select-branch") };
}
