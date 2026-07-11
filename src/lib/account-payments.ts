import type { SupabaseClient } from "@supabase/supabase-js";
import { allocatePayment } from "@/lib/allocation";

// Shared account-payment applier (#504 → Stripe balance payments). One code
// path for "money arrived for this customer's account": staff-recorded
// payments (payment-actions) and Stripe balance checkouts (webhook) both land
// here, so allocation order, rollups and `paid` semantics can never diverge.

type Admin = SupabaseClient;

export type ApplyAccountPaymentArgs = {
  organizationId: string;
  customerId: string;
  locationId: string;
  amount: number;
  method: string;
  reference: string | null;
  /** ISO date; defaults to today. */
  receivedAt?: string | null;
  recordedBy?: string | null;
};

export type ApplyAccountPaymentResult =
  | { error: string }
  | { paymentId: string; allocatedTo: number; unallocated: number };

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function applyAccountPayment(
  admin: Admin,
  args: ApplyAccountPaymentArgs,
): Promise<ApplyAccountPaymentResult> {
  const amount = r2(Number(args.amount));
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Payment amount must be greater than 0." };

  // Open invoices oldest-first (issue date, then number for stability).
  const { data: openRows } = await admin
    .from("invoices")
    .select("id, total, amount_paid, issued_at, invoice_number")
    .eq("customer_id", args.customerId)
    .eq("status", "sent")
    .order("issued_at", { ascending: true })
    .order("invoice_number", { ascending: true });
  const open = ((openRows ?? []) as { id: string; total: number; amount_paid: number }[])
    .map((i) => ({ id: i.id, outstanding: r2(Number(i.total) - Number(i.amount_paid ?? 0)) }))
    .filter((i) => i.outstanding > 0);

  const { allocations, unallocated } = allocatePayment(amount, open);

  const { data: payment, error: payErr } = await admin
    .from("payments")
    .insert({
      location_id: args.locationId,
      organization_id: args.organizationId,
      customer_id: args.customerId,
      amount,
      method: args.method,
      reference: args.reference?.trim().slice(0, 200) || null,
      received_at: args.receivedAt || new Date().toISOString().split("T")[0],
      recorded_by: args.recordedBy ?? null,
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
        .select("amount_paid")
        .eq("id", a.invoiceId)
        .maybeSingle();
      const paidNow = r2(Number((invRow as { amount_paid: number } | null)?.amount_paid ?? 0) + a.amount);
      await admin
        .from("invoices")
        .update({ amount_paid: paidNow, ...(covered ? { status: "paid", paid_at: nowIso } : {}) })
        .eq("id", a.invoiceId);
    }
  }

  return { paymentId: payment.id as string, allocatedTo: allocations.length, unallocated };
}
