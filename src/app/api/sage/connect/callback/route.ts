import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { exchangeSageCode, fetchSageBusinesses } from "@/lib/accounting/sage-provider";
import { saveAccountingConnection } from "@/lib/accounting/connection";
import { verifyOAuthState } from "@/lib/oauth-state";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Step 2 of Sage OAuth. Sage redirects here on the apex domain with
// ?code=...&state=<signed-token>. The signed state carries the orgId +
// userId that started the flow on a tenant subdomain (sessions are
// host-scoped, so no cookie here). Unlike QuickBooks there is no realm
// id on the URL — the business is discovered via GET /businesses and
// the first one is bound to the connection (v1; a picker can come later
// if multi-business Sage users show up).
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const errParam = url.searchParams.get("error");
  if (errParam) {
    return NextResponse.redirect(
      new URL(`/staff/settings?accounting=error&reason=${encodeURIComponent(errParam)}`, request.url),
    );
  }
  if (!state) {
    return NextResponse.redirect(new URL("/staff/settings?accounting=no-state", request.url));
  }

  const verified = verifyOAuthState(state);
  if (!verified.ok) {
    console.error("[sage/callback] invalid state", { reason: verified.reason });
    return NextResponse.redirect(
      new URL(`/staff/settings?accounting=bad-state&reason=${verified.reason}`, request.url),
    );
  }
  if (!code) {
    return NextResponse.redirect(new URL("/staff/settings?accounting=exchange-failed", request.url));
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
    return NextResponse.redirect(new URL("/staff/settings?accounting=forbidden", request.url));
  }

  // Resolve email for the audit log (no session context on the apex).
  let actorEmail: string | null = null;
  try {
    const { data: authUser } = await admin.auth.admin.getUserById(verified.userId);
    actorEmail = authUser.user?.email ?? null;
  } catch (err) {
    console.error("[sage/callback] getUserById failed", err);
  }

  try {
    const tokens = await exchangeSageCode(code);
    const businesses = await fetchSageBusinesses(tokens.accessToken);
    const business = businesses[0];
    if (!business) {
      return NextResponse.redirect(
        new URL("/staff/settings?accounting=no-tenants", request.url),
      );
    }

    await saveAccountingConnection({
      organizationId: verified.orgId,
      provider: "sage",
      externalId: business.id,
      displayName: business.displayedAs,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.expiresAt,
      connectedBy: verified.userId,
    });

    await logAudit({
      organizationId: verified.orgId,
      actorUserId: verified.userId,
      actorEmail,
      action: "accounting.connect_complete",
      entityType: "accounting_connection",
      entityId: business.id,
      metadata: { provider: "sage", businessName: business.displayedAs },
    });
  } catch (err) {
    console.error("[sage/callback] exchange failed", err);
    return NextResponse.redirect(
      new URL("/staff/settings?accounting=exchange-failed", request.url),
    );
  }

  // Back to the tenant settings page — subdomain is the org slug.
  const { data: org } = await admin
    .from("organizations")
    .select("slug")
    .eq("id", verified.orgId)
    .maybeSingle();
  const rootDomain =
    process.env.NEXT_PUBLIC_ROOT_DOMAIN ??
    request.headers.get("host") ??
    "ai-garage.co.uk";
  const protocol = rootDomain.includes("localtest") ? "http" : "https";
  const target = org?.slug
    ? `${protocol}://${org.slug}.${rootDomain}/staff/settings?tab=integrations&accounting=connected`
    : new URL("/staff/settings?tab=integrations&accounting=connected", request.url).toString();
  return NextResponse.redirect(target);
}
