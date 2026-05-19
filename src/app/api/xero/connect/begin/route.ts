import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { makeXeroClient } from "@/lib/xero";

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

  const client = makeXeroClient();
  // Pass org_id through the state param so the callback can map back.
  const consentUrl = await client.buildConsentUrl();
  const withState = consentUrl.includes("state=")
    ? consentUrl.replace(/state=[^&]*/, `state=${orgUser.organization_id}`)
    : `${consentUrl}&state=${orgUser.organization_id}`;

  return NextResponse.redirect(withState);
}
