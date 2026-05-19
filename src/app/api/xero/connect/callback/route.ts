import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { makeXeroClient } from "@/lib/xero";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Step 2 of Xero OAuth — Xero redirects here with ?code=... &state=<orgId>.
// We exchange the code for a token set, pull the connected tenant id, and
// persist both on organizations.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/staff/login", request.url));
  }

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

  const admin = createAdminClient();
  // Make sure the user owns/admins this org before persisting tokens.
  const { data: orgUser } = await admin
    .from("org_users")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .eq("organization_id", state)
    .maybeSingle();
  if (!orgUser || (orgUser.role !== "owner" && orgUser.role !== "admin")) {
    return NextResponse.redirect(new URL("/staff/settings?xero=forbidden", request.url));
  }

  const client = makeXeroClient();
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
        xero_access_token: tokenSet.access_token,
        xero_refresh_token: tokenSet.refresh_token,
        xero_token_expires_at: expiresAt,
        xero_connected_at: new Date().toISOString(),
      })
      .eq("id", state);
  } catch (err) {
    console.error("[xero/callback] exchange failed", err);
    return NextResponse.redirect(
      new URL("/staff/settings?xero=exchange-failed", request.url),
    );
  }

  return NextResponse.redirect(new URL("/staff/settings?xero=connected", request.url));
}
