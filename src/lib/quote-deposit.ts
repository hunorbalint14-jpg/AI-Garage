import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { createStaffNotification } from "@/lib/staff-notifications";
import { applyApprovedItems } from "@/app/quote/[slug]/actions";

// Called from /api/webhooks/stripe when a deposit Checkout session completes.
// Idempotent: checks deposit_paid_at + applied_job_item_ids before doing work,
// so Stripe webhook replays are safe.
export async function applyQuoteDeposit(args: {
  quoteId: string;
  paymentIntentId: string | null;
  checkoutSessionId: string;
  amountPence: number;
}): Promise<void> {
  const admin = createAdminClient();

  const { data: q } = await admin
    .from("job_quotes")
    .select(
      "id, job_id, location_id, total, created_by, deposit_paid_at, applied_job_item_ids, job:jobs(customer:customers(full_name), vehicle:vehicles(registration), location:locations(organization_id))",
    )
    .eq("id", args.quoteId)
    .maybeSingle();

  type Row = {
    id: string;
    job_id: string;
    location_id: string;
    total: number;
    created_by: string | null;
    deposit_paid_at: string | null;
    applied_job_item_ids: string[];
    job: {
      customer: { full_name: string | null } | null;
      vehicle: { registration: string | null } | null;
      location: { organization_id: string | null } | null;
    } | null;
  };
  const quote = q as Row | null;
  if (!quote) {
    console.error("[quote-deposit] quote not found", { quoteId: args.quoteId });
    return;
  }

  // Already processed — webhook replay or duplicate event.
  if (quote.deposit_paid_at) return;

  await admin
    .from("job_quotes")
    .update({
      deposit_paid_at: new Date().toISOString(),
      stripe_payment_intent_id: args.paymentIntentId,
      stripe_checkout_session_id: args.checkoutSessionId,
    })
    .eq("id", quote.id)
    .is("deposit_paid_at", null);

  // Apply the snapshot items now that the deposit has cleared.
  const result = await applyApprovedItems(quote.id);

  await logAudit({
    organizationId: quote.job?.location?.organization_id ?? null,
    action: "quote.deposit_paid",
    entityType: "job_quote",
    entityId: quote.id,
    metadata: {
      job_id: quote.job_id,
      total: quote.total,
      deposit_pence: args.amountPence,
      items_added: result.appliedIds.length,
      payment_intent_id: args.paymentIntentId,
    },
  });

  // Notify the mechanic.
  const recipients = new Set<string>();
  if (quote.created_by) {
    const { data: actor } = await admin.auth.admin.getUserById(quote.created_by);
    if (actor?.user?.email) recipients.add(actor.user.email);
  }
  const { data: locMembers } = await admin
    .from("location_users")
    .select("user_id")
    .eq("location_id", quote.location_id);
  for (const m of locMembers ?? []) {
    const { data: u } = await admin.auth.admin.getUserById((m as { user_id: string }).user_id);
    if (u?.user?.email) recipients.add(u.user.email);
  }

  const totalFmt = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(args.amountPence / 100);
  const who = quote.job?.customer?.full_name ?? "Customer";
  const reg = quote.job?.vehicle?.registration ?? "the vehicle";
  const subject = `✓ Deposit paid by ${who} (${reg})`;
  const text = `${who} paid the deposit (${totalFmt}) for the additional-work quote on ${reg}. The items have been added to the job — continue the work.`;

  for (const email of recipients) {
    await sendEmail({ to: email, subject, text });
  }

  void createStaffNotification({
    userId: quote.created_by,
    locationId: quote.location_id,
    organizationId: quote.job?.location?.organization_id ?? null,
    kind: "quote.deposit_paid",
    title: subject.replace(/^[^A-Za-z]+/, ""),
    body: `${reg} · ${totalFmt} deposit captured`,
    href: `/staff/jobs/${quote.job_id}`,
    entityType: "job_quote",
    entityId: quote.id,
  });
}
