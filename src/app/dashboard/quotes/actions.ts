"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getPortalContext, requireOwnedQuote } from "@/lib/portal-auth";
import { applyApprovedItems } from "@/app/quote/[slug]/actions";
import { getQuoteVatRate } from "@/lib/quote-service";
import { logAudit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { createStaffNotification } from "@/lib/staff-notifications";
import { stripe, platformFeePence, tenantOrigin } from "@/lib/stripe";
import { effectiveFeePercent } from "@/lib/tenant-plans";

// Owner-authenticated quote responses for the logged-in customer portal.
//
// This is deliberately ISOLATED from the token-gated /quote/[slug]/actions.ts
// path (live revenue code) — it authorises via the portal session + ownership
// instead of a token, and drives the SAME database transitions and the SAME
// Stripe deposit metadata (so the existing webhook applies items on payment).
// We reuse the already-exported applyApprovedItems(); the rest is replicated
// here on purpose so the token path is never touched.

export type OwnerApproveResult = { error: string } | { success: true; depositUrl?: string };
export type OwnerDeclineResult = { error: string } | { success: true };

type OrgRow = {
  id: string;
  name: string;
  stripe_account_id: string | null;
  stripe_charges_enabled: boolean | null;
  quote_deposit_pct: number | null;
  tenant_plan: string | null;
  tenant_subscription_status: string | null;
  tenant_current_period_end: string | null;
  tenant_trial_end: string | null;
};

function approvedTotals(items: { quantity: number; unit_price: number }[], vatRate: number) {
  const subtotal = items.reduce((sum, it) => sum + it.quantity * it.unit_price, 0);
  const approvedSubtotal = Math.round(subtotal * 100) / 100;
  const approvedVat = Math.round(approvedSubtotal * vatRate) / 100;
  const approvedTotal = Math.round((approvedSubtotal + approvedVat) * 100) / 100;
  return { approvedTotal };
}

async function loadOrg(locationId: string): Promise<OrgRow | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("locations")
    .select("organization:organizations!organization_id(id, name, stripe_account_id, stripe_charges_enabled, quote_deposit_pct, tenant_plan, tenant_subscription_status, tenant_current_period_end, tenant_trial_end)")
    .eq("id", locationId)
    .maybeSingle();
  return ((data as { organization: OrgRow | null } | null)?.organization ?? null);
}

// Registration for the quote's vehicle. job_quotes reach the vehicle via the
// parent job; standalone_quotes carry vehicle_id directly. Used only to
// enrich the staff notification, so a null reg is fine.
async function vehicleRegForQuote(source: "job" | "standalone", quoteId: string, jobId: string | null): Promise<string | null> {
  const admin = createAdminClient();
  if (source === "standalone") {
    const { data } = await admin.from("quotes").select("vehicle:vehicles(registration)").eq("id", quoteId).maybeSingle();
    return (data as { vehicle: { registration: string | null } | null } | null)?.vehicle?.registration ?? null;
  }
  if (!jobId) return null;
  const { data } = await admin.from("jobs").select("vehicle:vehicles(registration)").eq("id", jobId).maybeSingle();
  return (data as { vehicle: { registration: string | null } | null } | null)?.vehicle?.registration ?? null;
}

// Compact staff notification (email + in-app bell), mirroring the token path's
// notify but built from the public helpers so we don't touch that module.
async function notifyStaff(args: {
  quoteId: string;
  locationId: string;
  organizationId: string | null;
  decision: "approved" | "declined";
  reason: string | null;
  total: number;
  vehicleReg: string | null;
  customerName: string | null;
  createdBy: string | null;
}) {
  const admin = createAdminClient();
  const recipients = new Set<string>();
  if (args.createdBy) {
    const { data: actor } = await admin.auth.admin.getUserById(args.createdBy);
    if (actor?.user?.email) recipients.add(actor.user.email);
  }
  const { data: members } = await admin.from("location_users").select("user_id").eq("location_id", args.locationId);
  for (const m of members ?? []) {
    const { data: u } = await admin.auth.admin.getUserById((m as { user_id: string }).user_id);
    if (u?.user?.email) recipients.add(u.user.email);
  }

  const totalFmt = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(args.total);
  const who = args.customerName ?? "Customer";
  const reg = args.vehicleReg ?? "the vehicle";
  const approved = args.decision === "approved";
  const subject = approved ? `✓ Quote approved by ${who} (${reg})` : `✗ Quote declined by ${who} (${reg})`;
  const text = approved
    ? `${who} approved the quote on ${reg} (${totalFmt}) from their account.`
    : `${who} declined the quote on ${reg} (${totalFmt}).${args.reason ? `\n\nReason: ${args.reason}` : ""}`;

  for (const email of recipients) await sendEmail({ to: email, subject, text });

  void createStaffNotification({
    userId: args.createdBy,
    locationId: args.locationId,
    organizationId: args.organizationId,
    kind: approved ? "quote.approved" : "quote.declined",
    title: subject.replace(/^[^A-Za-z]+/, ""),
    body: `${reg} · ${totalFmt}${args.reason ? ` · "${args.reason}"` : ""}`,
    href: `/staff/quotes/${args.quoteId}`,
    entityType: "job_quote",
    entityId: args.quoteId,
  });
}

export async function approveQuoteAsOwner(quoteId: string): Promise<OwnerApproveResult> {
  const { location, customer } = await getPortalContext();
  if (!customer) return { error: "We couldn't find your account." };

  const quote = await requireOwnedQuote(customer.id, quoteId);
  if (quote.status !== "pending") return { error: "This quote has already been responded to." };

  const admin = createAdminClient();
  const org = await loadOrg(location.id);
  const depositPct = Number(org?.quote_deposit_pct ?? 0);
  const depositRequired = depositPct > 0 && !!org?.stripe_account_id && !!org.stripe_charges_enabled;

  const itemsTable = quote.source === "job" ? "quote_items" : "quote_items";
  const { data: itemRows } = await admin
    .from(itemsTable)
    .select("id, quantity, unit_price")
    .eq("quote_id", quote.id);
  const items = (itemRows ?? []) as { id: string; quantity: number; unit_price: number }[];
  if (items.length === 0) return { error: "This quote has no items to approve." };

  const vatRate = await getQuoteVatRate(admin, quote.id);
  const { approvedTotal } = approvedTotals(items, vatRate);
  const depositAmount = depositRequired ? Math.round(approvedTotal * depositPct) / 100 : 0;
  const allItemIds = items.map((it) => it.id);

  const quotesTable = "quotes";

  // Atomic claim: only a row still `pending` flips, so a concurrent token-path
  // response can't double-apply.
  const { data: claimed, error: claimErr } = await admin
    .from(quotesTable)
    .update({
      status: "approved",
      responded_at: new Date().toISOString(),
      approved_item_ids: allItemIds,
      deposit_required: depositRequired,
      deposit_pct: depositRequired ? depositPct : null,
      deposit_amount: depositRequired ? depositAmount : null,
    })
    .eq("id", quote.id)
    .eq("status", "pending")
    .select("id, location_id, total, created_by")
    .maybeSingle();
  if (claimErr) return { error: claimErr.message };
  if (!claimed) return { error: "This quote has already been responded to." };

  const q = claimed as { id: string; location_id: string; total: number; created_by: string | null };
  const vehicleReg = await vehicleRegForQuote(quote.source, q.id, quote.job_id);
  const metaKey = quote.source === "job" ? "quote_id" : "standalone_quote_id";

  // Deposit path — create Checkout with the SAME metadata the webhook already
  // handles; items are applied on payment success (job quotes) by the webhook.
  if (depositRequired && depositAmount > 0 && org?.stripe_account_id) {
    const amountPence = Math.round(depositAmount * 100);
    try {
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: "gbp",
                unit_amount: amountPence,
                product_data: {
                  name: `${depositPct}% deposit · ${org.name}`,
                  description: `Quote acceptance for ${vehicleReg ?? "your vehicle"}`,
                },
              },
            },
          ],
          payment_intent_data: { application_fee_amount: platformFeePence(amountPence, effectiveFeePercent(org)), metadata: { [metaKey]: q.id } },
          metadata: { [metaKey]: q.id },
          success_url: `${tenantOrigin(location.slug)}/dashboard/quotes/${q.id}?deposit=success`,
          cancel_url: `${tenantOrigin(location.slug)}/dashboard/quotes/${q.id}`,
        },
        { stripeAccount: org.stripe_account_id },
      );

      await admin.from(quotesTable).update({ stripe_checkout_session_id: session.id }).eq("id", q.id);
      await logAudit({
        organizationId: org.id,
        action: quote.source === "job" ? "quote.approve" : "quote.approve",
        entityType: quote.source === "job" ? "job_quote" : "standalone_quote",
        entityId: q.id,
        metadata: { total: approvedTotal, deposit_pending: true, deposit_pct: depositPct, via: "portal" },
      });

      if (!session.url) return { error: "Stripe did not return a checkout URL." };
      return { success: true, depositUrl: session.url };
    } catch (err) {
      console.error("[portal-quote] checkout create failed", err);
      // Don't strand the quote in approved-without-deposit limbo.
      await admin
        .from(quotesTable)
        .update({ status: "pending", responded_at: null, deposit_required: false, deposit_pct: null, deposit_amount: null })
        .eq("id", q.id);
      return { error: "Couldn't start the deposit payment. Please try again or contact the garage." };
    }
  }

  // No deposit — for job quotes, apply the approved items to the job now
  // (reuses the exported helper; safely no-ops if the job is no longer open).
  if (quote.source === "job") await applyApprovedItems(q.id);

  await logAudit({
    organizationId: org?.id ?? null,
    action: quote.source === "job" ? "quote.approve" : "quote.approve",
    entityType: quote.source === "job" ? "job_quote" : "standalone_quote",
    entityId: q.id,
    metadata: { total: approvedTotal, via: "portal" },
  });

  void notifyStaff({
    quoteId: q.id,
    locationId: q.location_id,
    organizationId: org?.id ?? null,
    decision: "approved",
    reason: null,
    total: approvedTotal,
    vehicleReg,
    customerName: customer.full_name,
    createdBy: q.created_by,
  });

  return { success: true };
}

export async function declineQuoteAsOwner(quoteId: string, reason: string | null): Promise<OwnerDeclineResult> {
  const { location, customer } = await getPortalContext();
  if (!customer) return { error: "We couldn't find your account." };

  const quote = await requireOwnedQuote(customer.id, quoteId);
  if (quote.status !== "pending") return { error: "This quote has already been responded to." };

  const admin = createAdminClient();
  const cleanReason = reason?.trim().slice(0, 1000) || null;
  const quotesTable = "quotes";

  const { data: claimed, error: claimErr } = await admin
    .from(quotesTable)
    .update({ status: "declined", responded_at: new Date().toISOString(), decline_reason: cleanReason })
    .eq("id", quote.id)
    .eq("status", "pending")
    .select("id, location_id, total, created_by")
    .maybeSingle();
  if (claimErr) return { error: claimErr.message };
  if (!claimed) return { error: "This quote has already been responded to." };

  const q = claimed as { id: string; location_id: string; total: number; created_by: string | null };
  const org = await loadOrg(location.id);
  const vehicleReg = await vehicleRegForQuote(quote.source, q.id, quote.job_id);

  await logAudit({
    organizationId: org?.id ?? null,
    action: quote.source === "job" ? "quote.decline" : "quote.decline",
    entityType: quote.source === "job" ? "job_quote" : "standalone_quote",
    entityId: q.id,
    metadata: { total: q.total, reason: cleanReason, via: "portal" },
  });

  void notifyStaff({
    quoteId: q.id,
    locationId: q.location_id,
    organizationId: org?.id ?? null,
    decision: "declined",
    reason: cleanReason,
    total: q.total,
    vehicleReg,
    customerName: customer.full_name,
    createdBy: q.created_by,
  });

  return { success: true };
}
