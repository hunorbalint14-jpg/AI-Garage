"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyAccountPayment } from "@/lib/account-payments";
import { buildStatement } from "@/lib/statement";
import { logAudit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { garageLabel, garageLocationBlock } from "@/lib/garage-identity";

// Account payments + statements (#504 PR 4). recordPayment allocates
// oldest-first across open invoices; an invoice flips to 'paid' only when
// fully covered (partials stay 'sent' with amount_paid — every existing
// status read stays correct). Overpayment stays unallocated on the payment.

export type RecordPaymentResult =
  | { error: string }
  | { success: true; allocatedTo: number; unallocated: number };

export async function recordPayment(
  customerId: string,
  args: { amount: number; method: string; reference: string | null; receivedAt: string | null },
): Promise<RecordPaymentResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "invoices")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const method = ["bank_transfer", "card", "cash", "cheque", "other"].includes(args.method) ? args.method : "bank_transfer";

  const { data: cust } = await admin
    .from("customers")
    .select("id, organization_id")
    .eq("id", customerId)
    .maybeSingle();
  if (!cust || (cust as { organization_id: string }).organization_id !== ctx.organization.id) {
    return { error: "Customer not found." };
  }

  // Shared applier (also used by the Stripe balance-payment webhook) so
  // allocation order, rollups and `paid` semantics can never diverge.
  const applied = await applyAccountPayment(admin, {
    organizationId: ctx.organization.id,
    customerId,
    locationId: ctx.location.id,
    amount: args.amount,
    method,
    reference: args.reference,
    receivedAt: args.receivedAt,
    recordedBy: ctx.user.id,
  });
  if ("error" in applied) return applied;

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "payment.recorded",
    entityType: "payment",
    entityId: applied.paymentId,
    metadata: { customer_id: customerId, amount: args.amount, method, allocations: applied.allocatedTo, unallocated: applied.unallocated },
  });

  revalidatePath(`/staff/customers/${customerId}`);
  return { success: true, allocatedTo: applied.allocatedTo, unallocated: applied.unallocated };
}

// Statement data used by both the print page and the email.
export async function loadStatementData(admin: ReturnType<typeof createAdminClient>, customerId: string) {
  const [{ data: invoices }, { data: payments }] = await Promise.all([
    admin
      .from("invoices")
      .select("id, invoice_number, issued_at, due_at, total, amount_paid, status, paid_at")
      .eq("customer_id", customerId)
      .order("issued_at", { ascending: true }),
    admin
      .from("payments")
      .select("id, received_at, amount, method, reference")
      .eq("customer_id", customerId)
      .order("received_at", { ascending: true }),
  ]);
  return {
    invoices: (invoices ?? []) as Parameters<typeof buildStatement>[0]["invoices"],
    payments: (payments ?? []) as Parameters<typeof buildStatement>[0]["payments"],
  };
}

export type EmailStatementResult = { error: string } | { success: true };

export async function emailStatement(
  customerId: string,
  args: { fromIso: string; toIso: string },
): Promise<EmailStatementResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "invoices")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const { data: custRow } = await admin
    .from("customers")
    .select("id, organization_id, full_name, email")
    .eq("id", customerId)
    .maybeSingle();
  const cust = custRow as { id: string; organization_id: string; full_name: string | null; email: string | null } | null;
  if (!cust || cust.organization_id !== ctx.organization.id) return { error: "Customer not found." };
  if (!cust.email) return { error: "Customer has no email address." };

  const data = await loadStatementData(admin, customerId);
  const statement = buildStatement({ ...data, fromIso: args.fromIso, toIso: args.toIso });

  const fmt = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
  const fmtD = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const { data: locRow } = await admin.from("locations").select("address").eq("id", ctx.location.id).maybeSingle();
  const identity = {
    orgName: ctx.organization.name,
    locationName: ctx.location.name,
    address: (locRow as { address: string | null } | null)?.address ?? null,
  };

  const lineText = statement.lines
    .map(
      (l) =>
        `${fmtD(l.date)}  ${l.kind === "invoice" ? "Invoice" : "Payment"} ${l.reference}  ${l.debit !== null ? fmt(l.debit) : `−${fmt(l.credit ?? 0)}`}  balance ${fmt(l.balance)}`,
    )
    .join("\n");
  const text =
    `Hi ${cust.full_name?.split(" ")[0] ?? "there"},\n\n` +
    `Your account statement for ${fmtD(args.fromIso)} – ${fmtD(new Date(new Date(args.toIso).getTime() - 86_400_000).toISOString())}:\n\n` +
    `Opening balance: ${fmt(statement.opening)}\n${lineText || "(no activity this period)"}\nClosing balance: ${fmt(statement.closing)}\n\n` +
    `Outstanding now: ${fmt(statement.totalOutstanding)}\n` +
    `  Not yet due: ${fmt(statement.aging.current)}\n  1–30 days overdue: ${fmt(statement.aging.d30)}\n  31–60 days: ${fmt(statement.aging.d60)}\n  60+ days: ${fmt(statement.aging.d90)}\n\n` +
    `${garageLocationBlock(identity)}`;

  const res = await sendEmail({
    to: cust.email,
    subject: `Statement of account — ${garageLabel(identity)}`,
    text,
  });
  if (!res.success) return { error: res.error ?? "Failed to send." };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "statement.sent",
    entityType: "customer",
    entityId: customerId,
    metadata: { from: args.fromIso, to: args.toIso, closing: statement.closing, outstanding: statement.totalOutstanding },
  });
  return { success: true };
}
