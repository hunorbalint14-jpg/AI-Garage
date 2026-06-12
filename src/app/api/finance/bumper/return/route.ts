import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveFinanceConfig, toBumperConfig, normalizeBumperStatus } from "@/lib/finance";
import { verifyRedirect, bumperStatus } from "@/lib/finance/bumper";
import { tenantQuoteUrl } from "@/lib/quote-links";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

// Customer lands here from Bumper's hosted checkout (success_url and
// failure_url both point at this route; Bumper appends token, success and
// signature). The browser redirect is a hint, not proof — we verify the
// signature, then confirm the real outcome server-side with GET /v2/status/
// before recording anything, and bounce the customer back to their quote.

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const quoteSlug = q.get("qs");
  const quoteToken = q.get("qt");
  const bumperToken = q.get("token");
  const success = q.get("success");
  const signature = q.get("signature");

  if (!quoteSlug || !quoteToken) {
    return NextResponse.json({ error: "Missing quote reference" }, { status: 400 });
  }

  const admin = createAdminClient();

  type AppRow = {
    id: string;
    organization_id: string;
    status: string;
    location: { slug: string } | null;
  };

  const { data: appData } = bumperToken
    ? await admin
        .from("finance_applications")
        .select("id, organization_id, status, location:locations(slug)")
        .eq("token", bumperToken)
        .maybeSingle()
    : { data: null };
  const app = appData as AppRow | null;

  // Without a matching application + valid signature we can't trust anything
  // — send the customer back to the quote with no claim about the outcome.
  const fallbackUrl = app?.location?.slug
    ? `${tenantQuoteUrl(app.location.slug, quoteSlug, quoteToken)}&finance=unknown`
    : null;

  if (!app || !bumperToken || !success || !signature) {
    return fallbackUrl
      ? NextResponse.redirect(fallbackUrl)
      : NextResponse.json({ error: "Unknown application" }, { status: 400 });
  }

  const config = await getActiveFinanceConfig(app.organization_id);
  if (!config) {
    return NextResponse.redirect(fallbackUrl ?? "/");
  }

  if (!verifyRedirect({ success, token: bumperToken, signature }, toBumperConfig(config).secret)) {
    console.warn("[finance] bumper return signature mismatch", { token: bumperToken.slice(0, 8) });
    return NextResponse.redirect(fallbackUrl ?? "/");
  }

  // Confirm server-side; never trust the redirect alone.
  let outcome = "pending";
  try {
    const status = await bumperStatus(bumperToken, toBumperConfig(config));
    const normalized = normalizeBumperStatus(status.status);
    await admin
      .from("finance_applications")
      .update({ status: normalized, raw_last_status: status, updated_at: new Date().toISOString() })
      .eq("token", bumperToken);

    if (normalized === "completed" && app.status !== "completed") {
      await logAudit({
        organizationId: app.organization_id,
        action: "finance.application_completed",
        entityType: "finance_application",
        entityId: bumperToken,
        metadata: { quote_slug: quoteSlug, payment_type: status.payment_type ?? null },
      });
    }
    outcome = normalized === "completed" ? "success" : normalized === "in_progress" || normalized === "pending" ? "pending" : "failed";
  } catch (err) {
    console.error("[finance] bumper status confirm failed", err);
    outcome = "unknown";
  }

  const target = app.location?.slug
    ? `${tenantQuoteUrl(app.location.slug, quoteSlug, quoteToken)}&finance=${outcome}`
    : "/";
  return NextResponse.redirect(target);
}
