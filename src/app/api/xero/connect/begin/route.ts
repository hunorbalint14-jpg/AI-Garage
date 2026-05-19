import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { makeXeroClient } from "@/lib/xero";
import { signOAuthState } from "@/lib/oauth-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Step 1 of Xero OAuth — staff (owner/admin) hits this and we redirect
// to Xero's consent screen. State carries the org_id so the callback
// knows which org to persist tokens against.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/staff/login", request.url));
  }

  const admin = createAdminClient();
  const { data: orgUser } = await admin
    .from("org_users")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!orgUser || (orgUser.role !== "owner" && orgUser.role !== "admin")) {
    return NextResponse.redirect(new URL("/staff/settings?xero=forbidden", request.url));
  }

  // Build a signed state token carrying the orgId + userId. The callback
  // lands on the apex domain where the session cookie is invisible — the
  // state token replaces the session check there.
  const stateToken = signOAuthState({
    orgId: orgUser.organization_id as string,
    userId: user.id,
  });
  // Construct the XeroClient with our signed token as `state`. xero-node
  // uses it verbatim when it builds the consent URL and later checks the
  // returned state matches on apiCallback().
  const client = makeXeroClient(stateToken);
  const consentUrl = await client.buildConsentUrl();

  return NextResponse.redirect(consentUrl);
}
