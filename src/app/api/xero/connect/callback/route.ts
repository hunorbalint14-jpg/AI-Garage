import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { makeXeroClient } from "@/lib/xero";
import { verifyOAuthState } from "@/lib/oauth-state";
import { encrypt } from "@/lib/encryption";
import { logAudit } from "@/lib/audit";


// Step 2 of Xero OAuth. Xero redirects here on the apex domain with
// ?code=...&state=<signed-token>. The state token carries the orgId +
// userId that started the flow on a tenant subdomain — we don't have
// the user's session cookie here because cookies are host-scoped, so
// the signed state is the trust anchor instead.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const errParam = url.searchParams.get("error");
  if (errParam) {
    return NextResponse.redirect(
      new URL(`/staff/settings?xero=error&reason=${encodeURIComponent(errParam)}`, request.url),
    );
  }
  if (!state) {
    return NextResponse.redirect(new URL("/staff/settings?xero=no-state", request.url));
  }

  const verified = verifyOAuthState(state);
  if (!verified.ok) {
    console.error("[xero/callback] invalid state", { reason: verified.reason });
    return NextResponse.redirect(
      new URL(`/staff/settings?xero=bad-state&reason=${verified.reason}`, request.url),
    );
  }

  const admin = createAdminClient();

  // Re-verify owner/admin membership against the org from the signed state.
  const { data: orgUser } = await admin
    .from("org_users")
    .select("organization_id, role")
    .eq("user_id", verified.userId)
    .eq("organization_id", verified.orgId)
    .maybeSingle();
  if (!orgUser || (orgUser.role !== "owner" && orgUser.role !== "admin")) {
    return NextResponse.redirect(new URL("/staff/settings?xero=forbidden", request.url));
  }

  // Resolve email for the audit log. Apex callback has no session
  // context — fetch from auth.users via the admin client.
  let actorEmail: string | null = null;
  try {
    const { data: authUser } = await admin.auth.admin.getUserById(verified.userId);
    actorEmail = authUser.user?.email ?? null;
  } catch (err) {
    console.error("[xero/callback] getUserById failed", err);
  }

  // Pass the URL state to the SDK so its internal state-mismatch check
  // sees the same value we sent — otherwise xero-node throws RPError
  // "state mismatch" before we even read the verified payload.
  const client = makeXeroClient(state);
  try {
    const tokenSet = await client.apiCallback(request.url);
    await client.updateTenants();
    const tenant = client.tenants[0];
    if (!tenant) {
      return NextResponse.redirect(
        new URL("/staff/settings?xero=no-tenants", request.url),
      );
    }

    const expiresAt = new Date(
      (tokenSet.expires_at ?? Math.floor(Date.now() / 1000) + 1800) * 1000,
    ).toISOString();

    await admin
      .from("organizations")
      .update({
        xero_tenant_id: tenant.tenantId,
        xero_tenant_name: tenant.tenantName,
        xero_access_token: tokenSet.access_token ? encrypt(tokenSet.access_token) : null,
        xero_refresh_token: tokenSet.refresh_token ? encrypt(tokenSet.refresh_token) : null,
        xero_token_expires_at: expiresAt,
        xero_connected_at: new Date().toISOString(),
      })
      .eq("id", verified.orgId);

    await logAudit({
      organizationId: verified.orgId,
      actorUserId: verified.userId,
      actorEmail,
      action: "xero.connect_complete",
      entityType: "xero_tenant",
      entityId: tenant.tenantId,
      metadata: { tenantName: tenant.tenantName },
    });
  } catch (err) {
    console.error("[xero/callback] exchange failed", err);
    return NextResponse.redirect(
      new URL("/staff/settings?xero=exchange-failed", request.url),
    );
  }

  // Send the user back to their tenant settings page, not the apex.
  // Look up the org's first location slug so we can land them back where
  // they started.
  const { data: location } = await admin
    .from("locations")
    .select("slug")
    .eq("organization_id", verified.orgId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const rootDomain =
    process.env.NEXT_PUBLIC_ROOT_DOMAIN ??
    request.headers.get("host") ??
    "ai-garage.co.uk";
  const protocol = rootDomain.includes("localtest") ? "http" : "https";
  const target = location?.slug
    ? `${protocol}://${location.slug}.${rootDomain}/staff/settings?xero=connected`
    : new URL("/staff/settings?xero=connected", request.url).toString();
  return NextResponse.redirect(target);
}
