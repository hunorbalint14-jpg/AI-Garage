import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sageAuthUrl } from "@/lib/accounting/sage-provider";
import { signOAuthState } from "@/lib/oauth-state";
import { entitledTo, type OrgBilling } from "@/lib/tenant-plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Step 1 of Sage OAuth — staff (owner/admin) hits this and we redirect
// to Sage's consent screen. Same signed-state pattern as the Xero and
// QuickBooks flows: the callback lands on the apex domain where the
// session cookie is invisible, so the state token is the trust anchor.
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
    return NextResponse.redirect(new URL("/staff/settings?accounting=forbidden", request.url));
  }

  // Accounting sync is a Pro-tier feature.
  const { data: orgBilling } = await admin
    .from("organizations")
    .select("tenant_plan, tenant_subscription_status, tenant_current_period_end, tenant_trial_end")
    .eq("id", orgUser.organization_id)
    .maybeSingle();
  if (!entitledTo((orgBilling ?? { tenant_plan: "starter" }) as OrgBilling, "accounting")) {
    return NextResponse.redirect(new URL("/staff/settings/billing?upgrade=accounting", request.url));
  }

  const stateToken = signOAuthState({
    orgId: orgUser.organization_id as string,
    userId: user.id,
  });
  return NextResponse.redirect(sageAuthUrl(stateToken));
}
