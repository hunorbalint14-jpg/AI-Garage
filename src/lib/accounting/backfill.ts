import { createAdminClient } from "@/lib/supabase/admin";
import {
  pushAllocationToAccounting,
  pushCreditNoteToAccounting,
  pushInvoiceToAccounting,
  pushPaymentToAccounting,
} from "./sync";

// One sweep of everything the books-health panel counts as missing,
// oldest first, capped per entity type. Shared by the Settings "Retry
// sync now" button and the background retry cron — each push is
// individually idempotent, so re-running is always safe.

export type BackfillResult = { attempted: number; synced: number };

export async function runAccountingBackfill(
  orgId: string,
  connectedAt: string,
  cap = 20,
): Promise<BackfillResult> {
  const admin = createAdminClient();
  let attempted = 0;
  let synced = 0;

  const { data: invoices } = await admin
    .from("invoices")
    .select("id")
    .eq("organization_id", orgId)
    .is("accounting_invoice_id", null)
    .not("is_demo", "is", true)
    .gte("issued_at", connectedAt)
    .order("issued_at", { ascending: true })
    .limit(cap);
  for (const row of invoices ?? []) {
    attempted++;
    if (await pushInvoiceToAccounting(row.id as string)) synced++;
  }

  // Full-invoice payments — but NOT for invoices paid through account
  // payment allocations: those sync per allocation below, and pushing the
  // full total on top would double-pay the invoice provider-side.
  const { data: unpaidSync } = await admin
    .from("invoices")
    .select("id, total, paid_at, payment_allocations(id)")
    .eq("organization_id", orgId)
    .is("accounting_payment_id", null)
    .in("status", ["paid", "part_refunded", "refunded"])
    .not("is_demo", "is", true)
    .gte("issued_at", connectedAt)
    .order("issued_at", { ascending: true })
    .limit(cap);
  for (const row of (unpaidSync ?? []) as unknown as {
    id: string;
    total: number;
    paid_at: string | null;
    payment_allocations: { id: string }[] | null;
  }[]) {
    if ((row.payment_allocations ?? []).length > 0) continue;
    attempted++;
    const ok = await pushPaymentToAccounting({
      invoiceId: row.id,
      amountPence: Math.round(Number(row.total) * 100),
      paymentDate: row.paid_at ?? new Date().toISOString(),
      reference: "Sync retry",
    });
    if (ok) synced++;
  }

  // Account-payment allocations (#504) — the amounts actually received.
  const { data: allocations } = await admin
    .from("payment_allocations")
    .select("id, payment:payments!inner(organization_id, received_at)")
    .is("accounting_payment_id", null)
    .eq("payment.organization_id", orgId)
    .gte("payment.received_at", connectedAt.split("T")[0])
    .order("created_at", { ascending: true })
    .limit(cap);
  for (const row of (allocations ?? []) as unknown as { id: string }[]) {
    attempted++;
    if (await pushAllocationToAccounting(row.id)) synced++;
  }

  const { data: creditNotes } = await admin
    .from("credit_notes")
    .select("id")
    .eq("organization_id", orgId)
    .is("accounting_credit_note_id", null)
    .gte("created_at", connectedAt)
    .order("created_at", { ascending: true })
    .limit(cap);
  for (const row of creditNotes ?? []) {
    attempted++;
    if (await pushCreditNoteToAccounting(row.id as string)) synced++;
  }

  return { attempted, synced };
}
