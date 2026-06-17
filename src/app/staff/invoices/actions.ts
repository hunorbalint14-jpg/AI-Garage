"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { garageLabel } from "@/lib/garage-identity";
import { tenantPayUrl, stripe } from "@/lib/stripe";
import { buildInvoiceHtml } from "@/lib/invoice-html";
import { pushInvoiceToXero, pushPaymentToXero, pushCreditNoteToXero } from "@/lib/xero-sync";
import { recordRefundCreditNote, recomputeInvoiceRefundStatus } from "@/lib/credit-notes";
import {
  getMemberBenefits,
  computeCoverage,
  computeMemberDiscount,
  applyInvoiceTotals,
  discountDescription,
  finalizeCoverage,
} from "@/lib/service-plans";
import { logAudit } from "@/lib/audit";

export type CreateInvoiceResult = { error: string } | { success: true; invoiceId: string };

export async function createInvoiceFromJob(jobId: string): Promise<CreateInvoiceResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "invoices")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const [jobRes, itemsRes] = await Promise.all([
    admin
      .from("jobs")
      .select("id, location_id, customer_id, status, booking_id")
      .eq("id", jobId)
      .maybeSingle(),
    admin
      .from("job_items")
      .select("id, description, type, quantity, unit_price, service_id")
      .eq("job_id", jobId),
  ]);

  const job = jobRes.data as {
    id: string; location_id: string; customer_id: string | null; status: string; booking_id: string | null;
  } | null;
  if (!job || job.location_id !== ctx.location.id) return { error: "Job not found." };
  if (job.status === "open") return { error: "Complete the job before creating an invoice." };
  if (job.status === "invoiced") return { error: "Invoice already exists for this job." };

  const items = (itemsRes.data ?? []) as {
    id: string; description: string; type: string; quantity: number; unit_price: number; service_id: string | null;
  }[];

  const subtotal = items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.unit_price), 0);
  const vatRate = 20;

  // Membership benefits — included-service allowance covers matching lines (£0)
  // up to the per-period quota; the plan discount then applies to the rest.
  let membershipCredit = 0;
  let membershipCreditDescription: string | null = null;
  let usageWrites: { service_id: string; covered_qty: number; walk_in_pence: number }[] = [];
  let memberSubscriptionId: string | null = null;
  let memberPeriodEnd: string | null = null;
  let discountAmount = 0;
  let discountDescriptionText: string | null = null;

  const benefits = job.customer_id
    ? await getMemberBenefits(admin, job.customer_id, ctx.location.id)
    : null;

  if (benefits) {
    // Coverage (needs a current period to track usage against).
    if (benefits.included.length > 0 && benefits.currentPeriodEnd) {
      const bundle = new Map(benefits.included.map((i) => [i.service_id, i.quantity_per_period]));
      const { data: used } = await admin
        .from("plan_service_usage")
        .select("service_id, covered_qty")
        .eq("plan_subscription_id", benefits.subscriptionId)
        .eq("period_end", benefits.currentPeriodEnd)
        .in("status", ["reserved", "consumed"]);
      const usedMap = new Map<string, number>();
      for (const u of (used ?? []) as { service_id: string; covered_qty: number }[]) {
        usedMap.set(u.service_id, (usedMap.get(u.service_id) ?? 0) + Number(u.covered_qty));
      }
      const remaining = new Map<string, number>();
      for (const [sid, qpp] of bundle) remaining.set(sid, Math.max(0, qpp - (usedMap.get(sid) ?? 0)));

      const { coveredValue, perService } = computeCoverage(
        items.map((i) => ({ service_id: i.service_id, quantity: Number(i.quantity), unit_price: Number(i.unit_price) })),
        remaining,
      );
      if (coveredValue > 0) {
        const priceByService = new Map<string, number>();
        for (const i of items) if (i.service_id) priceByService.set(i.service_id, Number(i.unit_price));
        membershipCredit = coveredValue;
        membershipCreditDescription = `${benefits.planName} – included services`;
        memberSubscriptionId = benefits.subscriptionId;
        memberPeriodEnd = benefits.currentPeriodEnd;
        usageWrites = [...perService.entries()].map(([service_id, covered_qty]) => ({
          service_id,
          covered_qty,
          walk_in_pence: Math.round(covered_qty * (priceByService.get(service_id) ?? 0) * 100),
        }));
      }
    }

    // Discount on the amount still payable after membership coverage.
    if (benefits.discount) {
      const base = Math.max(0, subtotal - membershipCredit);
      discountAmount = computeMemberDiscount(base, benefits.discount);
      if (discountAmount > 0) discountDescriptionText = discountDescription(benefits.planName, benefits.discount);
    }
  }

  // A booking covered at booking time already reserved its allowance — fold that
  // pre-reserved value into the credit (the reservation is finalised below). The
  // `used` query above counts the reservation, so the generic coverage won't
  // double-cover the same line.
  if (job.booking_id) {
    const { data: reserved } = await admin
      .from("plan_service_usage")
      .select("plan_subscription_id, period_end, walk_in_pence")
      .eq("booking_id", job.booking_id)
      .eq("status", "reserved");
    const rrows = (reserved ?? []) as { plan_subscription_id: string; period_end: string | null; walk_in_pence: number }[];
    const reservedPence = rrows.reduce((s, r) => s + Number(r.walk_in_pence), 0);
    if (reservedPence > 0) {
      membershipCredit = Math.round((membershipCredit + reservedPence / 100) * 100) / 100;
      membershipCreditDescription = membershipCreditDescription ?? `${benefits?.planName ?? "Plan"} – included services`;
      memberSubscriptionId = memberSubscriptionId ?? rrows[0]?.plan_subscription_id ?? null;
      memberPeriodEnd = memberPeriodEnd ?? rrows[0]?.period_end ?? null;
    }
  }

  const { vatAmount, total } = applyInvoiceTotals({
    subtotal: Math.max(0, subtotal - membershipCredit),
    discountAmount,
    vatRate,
  });

  // Generate invoice number
  const { count } = await admin
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("location_id", ctx.location.id);

  const invoiceNumber = `INV-${String((count ?? 0) + 1).padStart(4, "0")}`;
  const today = new Date();
  const due = new Date(today);
  due.setDate(due.getDate() + 30);

  const { data: invoice, error } = await admin
    .from("invoices")
    .insert({
      location_id: ctx.location.id,
      customer_id: job.customer_id,
      job_id: jobId,
      invoice_number: invoiceNumber,
      subtotal,
      vat_rate: vatRate,
      vat_amount: vatAmount,
      total,
      discount_amount: discountAmount,
      discount_description: discountDescriptionText,
      membership_credit_amount: membershipCredit,
      membership_credit_description: membershipCreditDescription,
      issued_at: today.toISOString().split("T")[0],
      due_at: due.toISOString().split("T")[0],
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  await admin.from("jobs").update({ status: "invoiced" }).eq("id", jobId);

  // Record consumed allowance against this period so it can't be claimed twice.
  // Deleting the invoice (reopen) cascades these away via invoice_id FK.
  if (usageWrites.length > 0 && memberSubscriptionId && memberPeriodEnd) {
    await admin.from("plan_service_usage").insert(
      usageWrites.map((u) => ({
        plan_subscription_id: memberSubscriptionId,
        service_id: u.service_id,
        invoice_id: invoice.id,
        period_end: memberPeriodEnd,
        covered_qty: u.covered_qty,
        walk_in_pence: u.walk_in_pence,
      })),
    );
  }

  // Finalise a covered booking's reservation against this invoice (reserved →
  // consumed) so the drawn allowance + value are permanently recorded.
  if (job.booking_id) {
    await finalizeCoverage(admin, job.booking_id, invoice.id);
  }

  // Fire-and-forget: push to Xero. Logs internally, never blocks the
  // staff response.
  pushInvoiceToXero(invoice.id).catch((err) =>
    console.error("[invoices/createInvoiceFromJob] xero push failed", err),
  );

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "invoice.create",
    entityType: "invoice",
    entityId: invoice.id,
    metadata: { invoice_number: invoiceNumber, job_id: jobId, total, discount_amount: discountAmount, membership_credit_amount: membershipCredit },
  });

  revalidatePath(`/staff/jobs/${jobId}`);
  revalidatePath("/staff/invoices");
  revalidatePath("/staff/revenue");
  return { success: true, invoiceId: invoice.id };
}

export type InvoiceActionResult = { error: string } | { success: true };

export async function sendInvoice(invoiceId: string): Promise<InvoiceActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "invoices")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const [invoiceRes, orgRes, locRes] = await Promise.all([
    admin
      .from("invoices")
      .select("id, location_id, invoice_number, subtotal, vat_rate, vat_amount, total, discount_amount, discount_description, membership_credit_amount, membership_credit_description, issued_at, due_at, notes, customer:customers(full_name, email), job:jobs(id)")
      .eq("id", invoiceId)
      .maybeSingle(),
    admin
      .from("organizations")
      .select("name, phone, logo_url, primary_color, stripe_account_id, stripe_charges_enabled")
      .eq("id", ctx.organization.id)
      .maybeSingle(),
    admin.from("locations").select("address").eq("id", ctx.location.id).maybeSingle(),
  ]);
  const locationAddress = (locRes.data as { address: string | null } | null)?.address ?? null;

  type InvoiceRow = {
    id: string; location_id: string; invoice_number: string;
    subtotal: number; vat_rate: number; vat_amount: number; total: number;
    discount_amount: number; discount_description: string | null;
    membership_credit_amount: number; membership_credit_description: string | null;
    issued_at: string; due_at: string; notes: string | null;
    customer: { full_name: string | null; email: string | null } | null;
    job: { id: string } | null;
  };

  const invoice = invoiceRes.data as InvoiceRow | null;
  if (!invoice || invoice.location_id !== ctx.location.id) return { error: "Invoice not found." };
  if (!invoice.customer?.email) return { error: "Customer has no email address." };

  const itemsRes = invoice.job
    ? await admin.from("job_items").select("description, type, quantity, unit_price").eq("job_id", invoice.job.id)
    : { data: [] };

  const org = orgRes.data as {
    name: string;
    phone: string | null;
    logo_url: string | null;
    primary_color: string | null;
    stripe_account_id: string | null;
    stripe_charges_enabled: boolean | null;
  } | null;
  const garageName = org?.name ?? ctx.organization.name;
  const where = garageLabel({ orgName: garageName, locationName: ctx.location.name });
  const canPayOnline = !!org?.stripe_account_id && !!org?.stripe_charges_enabled;
  const payUrl = canPayOnline ? tenantPayUrl(invoice.id) : null;

  const html = buildInvoiceHtml({
    invoiceNumber: invoice.invoice_number,
    issuedAt: invoice.issued_at,
    dueAt: invoice.due_at,
    garageName,
    locationName: ctx.location.name,
    garageAddress: locationAddress,
    garagePhone: org?.phone ?? null,
    garageEmail: ctx.user.email ?? null,
    logoUrl: org?.logo_url ?? null,
    brandColor: org?.primary_color ?? "#1f2937",
    customerName: invoice.customer.full_name ?? "Customer",
    items: (itemsRes.data ?? []) as { description: string; type: string; quantity: number; unit_price: number }[],
    subtotal: invoice.subtotal,
    vatRate: invoice.vat_rate,
    vatAmount: invoice.vat_amount,
    total: invoice.total,
    discountAmount: invoice.discount_amount,
    discountDescription: invoice.discount_description,
    membershipCreditAmount: invoice.membership_credit_amount,
    membershipCreditDescription: invoice.membership_credit_description,
    notes: invoice.notes,
    payUrl,
  });

  const fmt = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

  const payLine = payUrl ? `\nPay online: ${payUrl}\n` : "";
  const emailResult = await sendEmail({
    to: invoice.customer.email,
    subject: `Invoice ${invoice.invoice_number} from ${where} — ${fmt(invoice.total)} due ${new Date(invoice.due_at).toLocaleDateString("en-GB")}`,
    text: `Invoice ${invoice.invoice_number} from ${where}. Total: ${fmt(invoice.total)}. Due: ${new Date(invoice.due_at).toLocaleDateString("en-GB")}.${payLine}Please view this email in an HTML client for the full invoice.`,
    html,
  });

  if (!emailResult.success) return { error: emailResult.error };

  await admin.from("invoices").update({ status: "sent" }).eq("id", invoiceId);

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "invoice.send",
    entityType: "invoice",
    entityId: invoiceId,
    metadata: {
      invoice_number: invoice.invoice_number,
      recipient: invoice.customer.email,
      total: invoice.total,
    },
  });

  revalidatePath(`/staff/invoices/${invoiceId}`);
  revalidatePath("/staff/invoices");
  revalidatePath("/staff/revenue");
  return { success: true };
}

export async function markInvoicePaid(invoiceId: string): Promise<InvoiceActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "invoices")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const { data: invoice } = await admin
    .from("invoices")
    .select("id, total, location_id")
    .eq("id", invoiceId)
    .eq("location_id", ctx.location.id)
    .maybeSingle();
  if (!invoice) return { error: "Invoice not found." };

  const paidAt = new Date().toISOString();
  const { error } = await admin
    .from("invoices")
    .update({ status: "paid", paid_at: paidAt })
    .eq("id", invoiceId)
    .eq("location_id", ctx.location.id);

  if (error) return { error: error.message };

  // Sync the payment to Xero, fire-and-forget.
  pushPaymentToXero({
    invoiceId,
    amountPence: Math.round(Number(invoice.total) * 100),
    paymentDate: paidAt,
    reference: "Manual mark-as-paid",
  }).catch((err) =>
    console.error("[invoices/markInvoicePaid] xero push failed", err),
  );

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "invoice.mark_paid",
    entityType: "invoice",
    entityId: invoiceId,
    metadata: { total: invoice.total, paid_at: paidAt },
  });

  revalidatePath(`/staff/invoices/${invoiceId}`);
  revalidatePath("/staff/invoices");
  revalidatePath("/staff/revenue");
  return { success: true };
}

// Refund a paid invoice (full or partial). If it was paid online, issues a
// Stripe refund on the org's Connect account; otherwise records a cash credit
// note. Either way a credit_notes row is written, the invoice status moves to
// part_refunded / refunded, and (online) a Xero credit note is pushed.
export async function refundInvoice(
  invoiceId: string,
  args: { amountPence?: number; reason?: string },
): Promise<InvoiceActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "invoices")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const { data: invoice } = await admin
    .from("invoices")
    .select("id, location_id, customer_id, total, vat_rate, status, stripe_payment_intent_id, stripe_paid_amount_pence")
    .eq("id", invoiceId)
    .eq("location_id", ctx.location.id)
    .maybeSingle();
  if (!invoice) return { error: "Invoice not found." };

  type Inv = {
    customer_id: string | null;
    total: number;
    vat_rate: number;
    status: string;
    stripe_payment_intent_id: string | null;
    stripe_paid_amount_pence: number | null;
  };
  const inv = invoice as unknown as Inv;
  if (inv.status !== "paid" && inv.status !== "part_refunded") {
    return { error: "Only a paid invoice can be refunded." };
  }

  const paidPence = inv.stripe_paid_amount_pence ?? Math.round(Number(inv.total) * 100);
  const { data: priorCns } = await admin.from("credit_notes").select("total").eq("invoice_id", invoiceId);
  const priorRefundedPence = Math.round(
    ((priorCns ?? []) as { total: number }[]).reduce((s, c) => s + (Number(c.total) || 0), 0) * 100,
  );
  const remainingPence = Math.max(0, paidPence - priorRefundedPence);

  const grossPence = args.amountPence && args.amountPence > 0 ? Math.round(args.amountPence) : remainingPence;
  if (grossPence <= 0) return { error: "Nothing left to refund." };
  if (grossPence > remainingPence) return { error: "Refund exceeds the remaining paid amount." };
  const reason = args.reason?.trim().slice(0, 500) || null;

  // Online refund via Stripe if this invoice was paid through Stripe.
  let stripeRefundId: string | null = null;
  if (inv.stripe_payment_intent_id) {
    const { data: org } = await admin
      .from("organizations")
      .select("stripe_account_id")
      .eq("id", ctx.organization.id)
      .maybeSingle();
    const acct = (org as { stripe_account_id: string | null } | null)?.stripe_account_id;
    if (!acct) return { error: "The garage's Stripe account isn't connected." };
    try {
      const refund = await stripe.refunds.create(
        { payment_intent: inv.stripe_payment_intent_id, amount: grossPence, metadata: { invoice_id: invoiceId } },
        { stripeAccount: acct },
      );
      stripeRefundId = refund.id;
    } catch (err) {
      return { error: `Stripe refund failed: ${(err as Error).message}` };
    }
  }

  const { creditNoteId } = await recordRefundCreditNote(admin, {
    invoiceId,
    locationId: ctx.location.id,
    customerId: inv.customer_id,
    grossPence,
    vatRate: Number(inv.vat_rate) || 0,
    reason,
    stripeRefundId,
    createdBy: ctx.user.id,
  });
  await recomputeInvoiceRefundStatus(admin, invoiceId);

  if (creditNoteId) {
    pushCreditNoteToXero(creditNoteId).catch((err) =>
      console.error("[invoices/refundInvoice] xero credit note push failed", err),
    );
  }

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "invoice.refund",
    entityType: "invoice",
    entityId: invoiceId,
    metadata: { gross_pence: grossPence, online: !!stripeRefundId, stripe_refund_id: stripeRefundId, credit_note_id: creditNoteId, reason },
  });

  revalidatePath(`/staff/invoices/${invoiceId}`);
  revalidatePath("/staff/invoices");
  revalidatePath("/staff/revenue");
  return { success: true };
}

export async function deleteInvoice(invoiceId: string): Promise<InvoiceActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "invoices")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const { data: invoice } = await admin
    .from("invoices")
    .select("id, location_id, job_id, status")
    .eq("id", invoiceId)
    .maybeSingle();

  if (!invoice || invoice.location_id !== ctx.location.id) return { error: "Invoice not found." };
  if (invoice.status === "paid") return { error: "Cannot delete a paid invoice." };

  await admin.from("invoices").delete().eq("id", invoiceId);

  if (invoice.job_id) {
    await admin.from("jobs").update({ status: "complete" }).eq("id", invoice.job_id);
  }

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "invoice.delete",
    entityType: "invoice",
    entityId: invoiceId,
    metadata: { job_id: invoice.job_id, prior_status: invoice.status },
  });

  revalidatePath("/staff/invoices");
  revalidatePath("/staff/revenue");
  redirect("/staff/invoices");
}
