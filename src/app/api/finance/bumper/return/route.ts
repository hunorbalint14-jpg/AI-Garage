import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveFinanceConfig, toBumperConfig, normalizeBumperStatus } from "@/lib/finance";
import { verifyRedirect, bumperStatus } from "@/lib/finance/bumper";
import { settleInvoiceFromFinance } from "@/lib/finance/settle";
import { tenantQuoteUrl } from "@/lib/quote-links";
import { tenantOrigin } from "@/lib/stripe";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

// Customer lands here from Bumper's hosted checkout (success_url and
// failure_url both point at this route; Bumper appends token, success and
// signature). The browser redirect is a hint, not proof — we verify the
// signature, then confirm the real outcome server-side with GET /v2/status/
// before recording anything, and bounce the customer back to their quote or
// invoice. Which one is decided by the application's subject_type, not by the
// query string, so the redirect target can't be spoofed.

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  // Quote-link credentials, present only for quote subjects (invoices return
  // to an id-addressed, auth-gated portal page so carry no token).
  const quoteSlug = q.get("qs");
  const quoteToken = q.get("qt");
  const bumperToken = q.get("token");
  const success = q.get("success");
  const signature = q.get("signature");

  const admin = createAdminClient();

  type AppRow = {
    id: string;
    organization_id: string;
    status: string;
    subject_type: string;
    subject_id: string;
    amount: number;
    location: { slug: string } | null;
  };

  const { data: appData } = bumperToken
    ? await admin
        .from("finance_applications")
        .select("id, organization_id, status, subject_type, subject_id, amount, location:locations(slug)")
        .eq("token", bumperToken)
        .maybeSingle()
    : { data: null };
  const app = appData as AppRow | null;

  // Without a matching application we can't trust — or even sensibly route —
  // anything. There's nowhere safe to send the customer, so 400.
  if (!app) {
    return NextResponse.json({ error: "Unknown application" }, { status: 400 });
  }

  const slug = app.location?.slug ?? null;
  const buildTarget = (outcome: string): string => {
    if (!slug) return "/";
    if (app.subject_type === "invoice") {
      return `${tenantOrigin(slug)}/invoice/${app.subject_id}?finance=${outcome}`;
    }
    // Quote subjects need the link back; if it's missing fall back to "/".
    if (!quoteSlug || !quoteToken) return "/";
    return `${tenantQuoteUrl(slug, quoteSlug, quoteToken)}&finance=${outcome}`;
  };

  if (!success || !signature) {
    return NextResponse.redirect(buildTarget("unknown"));
  }

  const config = await getActiveFinanceConfig(app.organization_id);
  if (!config) {
    return NextResponse.redirect(buildTarget("unknown"));
  }

  if (!verifyRedirect({ success, token: bumperToken!, signature }, toBumperConfig(config).secret)) {
    console.warn("[finance] bumper return signature mismatch", { token: bumperToken!.slice(0, 8) });
    return NextResponse.redirect(buildTarget("unknown"));
  }

  // Confirm server-side; never trust the redirect alone.
  let outcome = "pending";
  try {
    const status = await bumperStatus(bumperToken!, toBumperConfig(config));
    const normalized = normalizeBumperStatus(status.status);
    await admin
      .from("finance_applications")
      .update({ status: normalized, raw_last_status: status, updated_at: new Date().toISOString() })
      .eq("token", bumperToken!);

    if (normalized === "completed" && app.status !== "completed") {
      await logAudit({
        organizationId: app.organization_id,
        action: "finance.application_completed",
        entityType: "finance_application",
        entityId: bumperToken!,
        metadata: { subject_type: app.subject_type, subject_id: app.subject_id, payment_type: status.payment_type ?? null },
      });
    }
    if (normalized === "completed") {
      await settleInvoiceFromFinance(admin, { ...app, token: bumperToken! });
    }
    outcome = normalized === "completed" ? "success" : normalized === "in_progress" || normalized === "pending" ? "pending" : "failed";
  } catch (err) {
    console.error("[finance] bumper status confirm failed", err);
    outcome = "unknown";
  }

  return NextResponse.redirect(buildTarget(outcome));
}
