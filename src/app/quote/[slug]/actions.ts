"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { logAudit } from "@/lib/audit";
import { verifyQuoteAccess, tenantQuoteUrl } from "@/lib/quote-links";
import { stripe, platformFeePence, tenantOrigin, publicOrigin } from "@/lib/stripe";
import { createStaffNotification } from "@/lib/staff-notifications";

// Notify staff via both email AND in-app notification. The two surfaces are
// complementary — email reaches the mechanic when they're off the dashboard,
// the in-app bell reaches them when they're working in another tab.
async function notifyStaffOfDecision(args: {
  quoteId: string;
  jobId: string;
  locationId: string;
  organizationId: string | null;
  decision: "approved" | "declined" | "rebooked" | "deposit_paid";
  declineReason: string | null;
  total: number;
  vehicleReg: string | null;
  customerName: string | null;
  createdBy: string | null;
  bookingId?: string | null;
}) {
  const admin = createAdminClient();
  const recipients = new Set<string>();

  if (args.createdBy) {
    const { data: actor } = await admin.auth.admin.getUserById(args.createdBy);
    if (actor?.user?.email) recipients.add(actor.user.email);
  }

  const { data: locMembers } = await admin
    .from("location_users")
    .select("user_id")
    .eq("location_id", args.locationId);
  for (const m of locMembers ?? []) {
    const { data: u } = await admin.auth.admin.getUserById((m as { user_id: string }).user_id);
    if (u?.user?.email) recipients.add(u.user.email);
  }

  const totalFmt = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(args.total);
  const who = args.customerName ?? "Customer";
  const reg = args.vehicleReg ?? "the vehicle";

  let subject: string;
  let text: string;
  let kind: "quote.approved" | "quote.declined" | "quote.rebooked" | "quote.deposit_paid";
  let body: string;

  switch (args.decision) {
    case "approved":
      subject = `✓ Quote approved by ${who} (${reg})`;
      text = `${who} approved the additional-work quote on ${reg} (${totalFmt}). The items have been added to the job — continue the work.`;
      kind = "quote.approved";
      body = `${reg} · ${totalFmt}`;
      break;
    case "declined":
      subject = `✗ Quote declined by ${who} (${reg})`;
      text = `${who} declined the additional-work quote on ${reg} (${totalFmt}).${args.declineReason ? `\n\nReason: ${args.declineReason}` : ""}\n\nContinue with the original booking scope only.`;
      kind = "quote.declined";
      body = `${reg} · ${totalFmt}${args.declineReason ? ` · "${args.declineReason}"` : ""}`;
      break;
    case "rebooked":
      subject = `→ Quote → new booking from ${who} (${reg})`;
      text = `${who} declined the in-job upsell on ${reg} (${totalFmt}) but submitted a separate booking for the same scope. Open the new booking to start the work.`;
      kind = "quote.rebooked";
      body = `${reg} · ${totalFmt} · new booking submitted`;
      break;
    case "deposit_paid":
      subject = `✓ Deposit paid by ${who} (${reg})`;
      text = `${who} paid the deposit for the additional-work quote on ${reg} (${totalFmt}). The items have been added to the job — continue the work.`;
      kind = "quote.deposit_paid";
      body = `${reg} · ${totalFmt} · deposit captured`;
      break;
  }

  for (const email of recipients) {
    await sendEmail({ to: email, subject, text });
  }

  // In-app notification — target the original mechanic, fall back to location-wide
  // visibility via the location_id (any covering mechanic sees it).
  void createStaffNotification({
    userId: args.createdBy,
    locationId: args.locationId,
    organizationId: args.organizationId,
    kind,
    title: subject.replace(/^[^A-Za-z]+/, ""),
    body,
    href: `/staff/jobs/${args.jobId}`,
    entityType: "job_quote",
    entityId: args.quoteId,
  });
}

// ---------------------------------------------------------------------------
// Apply approved items to the job. Used by both the immediate-approval path
// (no deposit) and the webhook (deposit-paid). Idempotent — checks that
// applied_job_item_ids is still empty before inserting.
// ---------------------------------------------------------------------------
export async function applyApprovedItems(quoteId: string): Promise<{ appliedIds: string[]; jobOpen: boolean }> {
  const admin = createAdminClient();

  const { data: quote } = await admin
    .from("job_quotes")
    .select("id, job_id, approved_item_ids, applied_job_item_ids")
    .eq("id", quoteId)
    .maybeSingle();
  type QuoteRow = { id: string; job_id: string; approved_item_ids: string[]; applied_job_item_ids: string[] };
  const q = quote as QuoteRow | null;
  if (!q) return { appliedIds: [], jobOpen: false };

  // Already applied (webhook replay safety).
  if (q.applied_job_item_ids && q.applied_job_item_ids.length > 0) {
    return { appliedIds: q.applied_job_item_ids, jobOpen: true };
  }

  const { data: job } = await admin
    .from("jobs")
    .select("id, status")
    .eq("id", q.job_id)
    .maybeSingle();
  type JobRow = { id: string; status: string };
  const jobRow = job as JobRow | null;
  if (!jobRow || jobRow.status !== "open") return { appliedIds: [], jobOpen: false };

  let itemsQuery = admin
    .from("job_quote_items")
    .select("id, description, type, quantity, unit_price")
    .eq("quote_id", q.id)
    .order("sort_order");
  if (q.approved_item_ids && q.approved_item_ids.length > 0) {
    itemsQuery = itemsQuery.in("id", q.approved_item_ids);
  }
  const { data: snapshot } = await itemsQuery;

  const itemsToInsert = (snapshot ?? []).map((it) => ({
    job_id: q.job_id,
    description: (it as { description: string }).description,
    type: (it as { type: string }).type,
    quantity: (it as { quantity: number }).quantity,
    unit_price: (it as { unit_price: number }).unit_price,
  }));

  if (itemsToInsert.length === 0) return { appliedIds: [], jobOpen: true };

  const { data: inserted, error: insertErr } = await admin
    .from("job_items")
    .insert(itemsToInsert)
    .select("id");
  if (insertErr) {
    console.error("[quote] applyApprovedItems insert failed", insertErr);
    return { appliedIds: [], jobOpen: true };
  }
  const appliedIds = (inserted ?? []).map((r) => (r as { id: string }).id);

  await admin
    .from("job_quotes")
    .update({ applied_job_item_ids: appliedIds })
    .eq("id", q.id);

  return { appliedIds, jobOpen: true };
}

// ---------------------------------------------------------------------------
// approveQuote — partial approval via selectedItemIds (empty = all).
// If org has quote_deposit_pct > 0, returns a Stripe Checkout URL instead of
// applying items; items are applied by the webhook on deposit success.
// ---------------------------------------------------------------------------
export type ApproveResult =
  | { error: string }
  | { success: true; depositUrl?: string };

export async function approveQuote(
  slug: string,
  token: string,
  selectedItemIds: string[] = [],
): Promise<ApproveResult> {
  const verify = await verifyQuoteAccess(slug, token, ["pending"]);
  if (!verify.ok) {
    if (verify.reason === "wrong_status") return { error: "This quote has already been responded to." };
    if (verify.reason === "expired") return { error: "This quote has expired." };
    return { error: "Invalid link." };
  }

  const admin = createAdminClient();

  // Load items + org-level deposit setting BEFORE the atomic claim so we can
  // compute the approved total and decide whether a Checkout step is needed.
  const { data: allItems } = await admin
    .from("job_quote_items")
    .select("id, quantity, unit_price")
    .eq("quote_id", verify.quote.id);
  type ItemRow = { id: string; quantity: number; unit_price: number };
  const items = (allItems ?? []) as ItemRow[];

  const validSelectedIds = selectedItemIds.filter((id) => items.some((it) => it.id === id));
  const effectiveSelected = validSelectedIds.length > 0
    ? items.filter((it) => validSelectedIds.includes(it.id))
    : items;
  if (effectiveSelected.length === 0) return { error: "Select at least one item to approve." };

  const subtotal = effectiveSelected.reduce((sum, it) => sum + it.quantity * it.unit_price, 0);
  const VAT = 20;
  const approvedSubtotal = Math.round(subtotal * 100) / 100;
  const approvedVat = Math.round(approvedSubtotal * VAT) / 100;
  const approvedTotal = Math.round((approvedSubtotal + approvedVat) * 100) / 100;

  // Look up the org-level deposit policy + Stripe Connect details.
  // quote_deposit_pct is a v2 column; retry without it if the migration
  // hasn't run, so existing approve flow stays alive.
  const fullLocSelect = "id, slug, organization:organizations(id, name, stripe_account_id, stripe_charges_enabled, quote_deposit_pct)";
  const v1LocSelect = "id, slug, organization:organizations(id, name, stripe_account_id, stripe_charges_enabled)";

  let locRowData: unknown = null;
  const locFirst = await admin.from("locations").select(fullLocSelect).eq("id", verify.quote.location_id).maybeSingle();
  if (locFirst.error) {
    const locSecond = await admin.from("locations").select(v1LocSelect).eq("id", verify.quote.location_id).maybeSingle();
    locRowData = locSecond.data;
  } else {
    locRowData = locFirst.data;
  }
  type LocRow = {
    id: string;
    slug: string;
    organization: {
      id: string;
      name: string;
      stripe_account_id: string | null;
      stripe_charges_enabled: boolean | null;
      quote_deposit_pct?: number | null;
    } | null;
  };
  const loc = locRowData as LocRow | null;
  const org = loc?.organization ?? null;

  const depositPct = Number(org?.quote_deposit_pct ?? 0);
  const depositRequired =
    depositPct > 0 && !!org?.stripe_account_id && !!org.stripe_charges_enabled;
  const depositAmount = depositRequired
    ? Math.round(approvedTotal * depositPct) / 100
    : 0;

  // Atomic status transition — only the row still `pending` flips, so two
  // concurrent approvals can't both apply items. Try with v2 columns first;
  // fall back to the v1 minimal update if the v2 migration hasn't run.
  const claimUpdateFull: Record<string, unknown> = {
    status: "approved",
    responded_at: new Date().toISOString(),
    approved_item_ids: validSelectedIds.length > 0 ? validSelectedIds : items.map((it) => it.id),
    deposit_required: depositRequired,
    deposit_pct: depositRequired ? depositPct : null,
    deposit_amount: depositRequired ? depositAmount : null,
  };
  const claimUpdateMinimal: Record<string, unknown> = {
    status: "approved",
    responded_at: new Date().toISOString(),
  };

  let claimed: { id: string; job_id: string; location_id: string; total: number; created_by: string | null } | null = null;
  let claimErrMsg: string | null = null;

  const claimFirst = await admin
    .from("job_quotes")
    .update(claimUpdateFull)
    .eq("id", verify.quote.id)
    .eq("status", "pending")
    .select("id, job_id, location_id, total, created_by")
    .maybeSingle();
  if (claimFirst.error) {
    // Retry without v2 cols.
    const claimSecond = await admin
      .from("job_quotes")
      .update(claimUpdateMinimal)
      .eq("id", verify.quote.id)
      .eq("status", "pending")
      .select("id, job_id, location_id, total, created_by")
      .maybeSingle();
    if (claimSecond.error) claimErrMsg = claimSecond.error.message;
    else claimed = claimSecond.data as typeof claimed;
  } else {
    claimed = claimFirst.data as typeof claimed;
  }

  if (claimErrMsg) return { error: claimErrMsg };
  if (!claimed) return { error: "This quote has already been responded to." };

  type Claimed = { id: string; job_id: string; location_id: string; total: number; created_by: string | null };
  const q = claimed as Claimed;

  // Check job is still open. If not, mark approved_after_close and stop.
  const { data: jobRowData } = await admin
    .from("jobs")
    .select("id, status, customer:customers(full_name), vehicle:vehicles(registration)")
    .eq("id", q.job_id)
    .maybeSingle();
  type JobRow = {
    id: string;
    status: string;
    customer: { full_name: string | null } | null;
    vehicle: { registration: string | null } | null;
  };
  const jobRow = jobRowData as JobRow | null;

  if (!jobRow || jobRow.status !== "open") {
    await admin
      .from("job_quotes")
      .update({ status: "approved_after_close" })
      .eq("id", q.id);

    await logAudit({
      organizationId: org?.id ?? null,
      action: "quote.approve",
      entityType: "job_quote",
      entityId: q.id,
      metadata: { job_id: q.job_id, total: approvedTotal, after_close: true, partial: validSelectedIds.length > 0 },
    });

    void notifyStaffOfDecision({
      quoteId: q.id,
      jobId: q.job_id,
      locationId: q.location_id,
      organizationId: org?.id ?? null,
      decision: "approved",
      declineReason: null,
      total: approvedTotal,
      vehicleReg: jobRow?.vehicle?.registration ?? null,
      customerName: jobRow?.customer?.full_name ?? null,
      createdBy: q.created_by,
    });

    return { success: true };
  }

  // Deposit path — create a Stripe Checkout session on the org's Connect
  // account. Items are applied by the webhook on payment success.
  if (depositRequired && depositAmount > 0 && org && loc) {
    const customerName = jobRow.customer?.full_name ?? "Customer";
    const reg = jobRow.vehicle?.registration ?? "vehicle";
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
                  description: `Additional work on ${reg} (${customerName})`,
                },
              },
            },
          ],
          payment_intent_data: {
            application_fee_amount: platformFeePence(amountPence),
            metadata: { quote_id: q.id },
          },
          metadata: { quote_id: q.id },
          success_url: `${publicOrigin()}/quote/${slug}/deposit-success?t=${token}`,
          cancel_url: tenantQuoteUrl(loc.slug, slug, token),
        },
        { stripeAccount: org.stripe_account_id! },
      );

      await admin
        .from("job_quotes")
        .update({ stripe_checkout_session_id: session.id })
        .eq("id", q.id);

      await logAudit({
        organizationId: org.id,
        action: "quote.approve",
        entityType: "job_quote",
        entityId: q.id,
        metadata: { job_id: q.job_id, total: approvedTotal, deposit_pending: true, deposit_pct: depositPct, partial: validSelectedIds.length > 0 },
      });

      if (!session.url) return { error: "Stripe did not return a checkout URL." };
      // Use the existing tenantOrigin to keep the customer on a tenant subdomain
      // throughout — Stripe's hosted page already lives on stripe.com.
      void tenantOrigin; // keep import marked as used
      return { success: true, depositUrl: session.url };
    } catch (err) {
      console.error("[quote] checkout create failed", err);
      // Don't strand a quote in approved-without-deposit limbo — flip it back
      // to pending so the customer can retry.
      await admin
        .from("job_quotes")
        .update({ status: "pending", responded_at: null, deposit_required: false, deposit_pct: null, deposit_amount: null })
        .eq("id", q.id);
      return { error: "Couldn't start the deposit payment. Please try again or contact the garage." };
    }
  }

  // No deposit — apply items now.
  const { appliedIds } = await applyApprovedItems(q.id);

  await logAudit({
    organizationId: org?.id ?? null,
    action: "quote.approve",
    entityType: "job_quote",
    entityId: q.id,
    metadata: { job_id: q.job_id, total: approvedTotal, items_added: appliedIds.length, partial: validSelectedIds.length > 0 },
  });

  void notifyStaffOfDecision({
    quoteId: q.id,
    jobId: q.job_id,
    locationId: q.location_id,
    organizationId: org?.id ?? null,
    decision: "approved",
    declineReason: null,
    total: approvedTotal,
    vehicleReg: jobRow.vehicle?.registration ?? null,
    customerName: jobRow.customer?.full_name ?? null,
    createdBy: q.created_by,
  });

  return { success: true };
}

// ---------------------------------------------------------------------------
// declineQuote — unchanged from v1, plus in-app notification.
// ---------------------------------------------------------------------------
export type DeclineResult = { error: string } | { success: true };

export async function declineQuote(
  slug: string,
  token: string,
  reason: string | null,
): Promise<DeclineResult> {
  const verify = await verifyQuoteAccess(slug, token, ["pending"]);
  if (!verify.ok) {
    if (verify.reason === "wrong_status") return { error: "This quote has already been responded to." };
    if (verify.reason === "expired") return { error: "This quote has expired." };
    return { error: "Invalid link." };
  }

  const admin = createAdminClient();
  const cleanReason = reason?.trim().slice(0, 1000) || null;

  const { data: claimed, error: claimErr } = await admin
    .from("job_quotes")
    .update({
      status: "declined",
      responded_at: new Date().toISOString(),
      decline_reason: cleanReason,
    })
    .eq("id", verify.quote.id)
    .eq("status", "pending")
    .select("id, job_id, location_id, total, created_by")
    .maybeSingle();
  if (claimErr) return { error: claimErr.message };
  if (!claimed) return { error: "This quote has already been responded to." };

  type Claimed = { id: string; job_id: string; location_id: string; total: number; created_by: string | null };
  const q = claimed as Claimed;

  const { data: jobRowData } = await admin
    .from("jobs")
    .select("customer:customers(full_name), vehicle:vehicles(registration), location:locations(organization_id)")
    .eq("id", q.job_id)
    .maybeSingle();
  type JobRow = {
    customer: { full_name: string | null } | null;
    vehicle: { registration: string | null } | null;
    location: { organization_id: string | null } | null;
  };
  const jobRow = jobRowData as JobRow | null;

  await logAudit({
    organizationId: jobRow?.location?.organization_id ?? null,
    action: "quote.decline",
    entityType: "job_quote",
    entityId: q.id,
    metadata: { job_id: q.job_id, total: q.total, reason: cleanReason },
  });

  void notifyStaffOfDecision({
    quoteId: q.id,
    jobId: q.job_id,
    locationId: q.location_id,
    organizationId: jobRow?.location?.organization_id ?? null,
    decision: "declined",
    declineReason: cleanReason,
    total: q.total,
    vehicleReg: jobRow?.vehicle?.registration ?? null,
    customerName: jobRow?.customer?.full_name ?? null,
    createdBy: q.created_by,
  });

  return { success: true };
}

// ---------------------------------------------------------------------------
// declineAndRebook — customer declines now but wants the same scope as a
// separate appointment. Returns the booking widget URL with ?quote=&t= so
// the widget can prefill the scope and store from_quote_id on the booking.
// ---------------------------------------------------------------------------
export type RebookResult = { error: string } | { success: true; rebookUrl: string };

export async function declineAndRebook(slug: string, token: string): Promise<RebookResult> {
  const verify = await verifyQuoteAccess(slug, token, ["pending"]);
  if (!verify.ok) {
    if (verify.reason === "wrong_status") return { error: "This quote has already been responded to." };
    if (verify.reason === "expired") return { error: "This quote has expired." };
    return { error: "Invalid link." };
  }

  const admin = createAdminClient();

  const { data: claimed, error: claimErr } = await admin
    .from("job_quotes")
    .update({ status: "rebooked", responded_at: new Date().toISOString() })
    .eq("id", verify.quote.id)
    .eq("status", "pending")
    .select("id, job_id, location_id, total, created_by")
    .maybeSingle();
  if (claimErr) return { error: claimErr.message };
  if (!claimed) return { error: "This quote has already been responded to." };

  type Claimed = { id: string; job_id: string; location_id: string; total: number; created_by: string | null };
  const q = claimed as Claimed;

  const { data: locRow } = await admin
    .from("locations")
    .select("slug, organization:organizations(id)")
    .eq("id", q.location_id)
    .maybeSingle();
  type LocRow = { slug: string; organization: { id: string } | null };
  const loc = locRow as LocRow | null;
  if (!loc) return { error: "Garage not found." };

  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "ai-garage.co.uk";
  const isLocal = rootDomain.includes("localtest") || rootDomain.includes("localhost");
  const proto = isLocal ? "http" : "https";
  const rebookUrl = `${proto}://${loc.slug}.${rootDomain}/book?quote=${slug}&t=${encodeURIComponent(token)}`;

  await logAudit({
    organizationId: loc.organization?.id ?? null,
    action: "quote.rebook",
    entityType: "job_quote",
    entityId: q.id,
    metadata: { job_id: q.job_id, total: q.total },
  });

  // Note: the staff notification with the new booking_id is fired by
  // submitWidgetBooking() when the customer actually completes the new
  // booking — fire-and-forget here would be premature.

  return { success: true, rebookUrl };
}
