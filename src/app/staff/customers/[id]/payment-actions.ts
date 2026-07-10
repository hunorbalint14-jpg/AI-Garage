"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { allocatePayment } from "@/lib/allocation";
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

  const amount = Math.round(Number(args.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Payment amount must be greater than 0." };
  const method = ["bank_transfer", "card", "cash", "cheque", "other"].includes(args.method) ? args.method : "bank_transfer";

  const { data: cust } = await admin
    .from("customers")
    .select("id, organization_id")
    .eq("id", customerId)
    .maybeSingle();
  if (!cust || (cust as { organization_id: string }).organization_id !== ctx.organization.id) {
    return { error: "Customer not found." };
  }

  // Open invoices oldest-first (issue date, then number for stability).
  const { data: openRows } = await admin
    .from("invoices")
    .select("id, total, amount_paid, issued_at, invoice_number")
    .eq("customer_id", customerId)
    .eq("status", "sent")
    .order("issued_at", { ascending: true })
    .order("invoice_number", { ascending: true });
  const open = ((openRows ?? []) as { id: string; total: number; amount_paid: number }[])
    .map((i) => ({ id: i.id, outstanding: Math.round((Number(i.total) - Number(i.amount_paid ?? 0)) * 100) / 100 }))
    .filter((i) => i.outstanding > 0);

  const { allocations, unallocated } = allocatePayment(amount, open);

  const { data: payment, error: payErr } = await admin
    .from("payments")
    .insert({
      location_id: ctx.location.id,
      customer_id: customerId,
      amount,
      method,
      reference: args.reference?.trim().slice(0, 200) || null,
      received_at: args.receivedAt || new Date().toISOString().split("T")[0],
      recorded_by: ctx.user.id,
    })
    .select("id")
    .single();
  if (payErr || !payment) return { error: payErr?.message ?? "Could not record the payment." };

  if (allocations.length > 0) {
    const { error: allocErr } = await admin.from("payment_allocations").insert(
      allocations.map((a) => ({ payment_id: payment.id, invoice_id: a.invoiceId, amount: a.amount })),
    );
    if (allocErr) {
      await admin.from("payments").delete().eq("id", payment.id);
      return { error: allocErr.message };
    }
    // Roll up per invoice; fully covered flips to paid.
    const nowIso = new Date().toISOString();
    for (const a of allocations) {
      const before = open.find((o) => o.id === a.invoiceId)!;
      const covered = a.amount >= before.outstanding;
      const { data: invRow } = await admin
        .from("invoices")
        .select("amount_paid, total")
        .eq("id", a.invoiceId)
        .maybeSingle();
      const paidNow =
        Math.round(((Number((invRow as { amount_paid: number } | null)?.amount_paid ?? 0)) + a.amount) * 100) / 100;
      await admin
        .from("invoices")
        .update({ amount_paid: paidNow, ...(covered ? { status: "paid", paid_at: nowIso } : {}) })
        .eq("id", a.invoiceId);
    }
  }

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "payment.recorded",
    entityType: "payment",
    entityId: payment.id,
    metadata: { customer_id: customerId, amount, method, allocations: allocations.length, unallocated },
  });

  revalidatePath(`/staff/customers/${customerId}`);
  return { success: true, allocatedTo: allocations.length, unallocated };
}

// Statement data used by both the print page and the email.
export async function loadStatementData(admin: ReturnType<typeof createAdminClient>, customerId: string) {
  const [{ data: invoices }, { data: payments }] = await Promise.all([
    admin
      .from("invoices")
      .select("id, invoice_number, issued_at, due_at, total, amount_paid, status")
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
