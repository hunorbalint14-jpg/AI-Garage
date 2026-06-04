import { createAdminClient } from "@/lib/supabase/admin";

// Shared credit-note logic used by both the staff refund action and the Stripe
// charge.refunded webhook, so a refund recorded by one path isn't duplicated by
// the other (dedupe is on the unique credit_notes.stripe_refund_id).

type Admin = ReturnType<typeof createAdminClient>;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Split a gross refund (in pence) into net + VAT using the invoice's VAT rate.
export function splitGross(grossPence: number, vatRate: number): { subtotal: number; vat: number; total: number } {
  const total = round2(grossPence / 100);
  const rate = Number(vatRate) || 0;
  const net = round2(total / (1 + rate / 100));
  const vat = round2(total - net);
  return { subtotal: net, vat, total };
}

// Insert a credit note, idempotent on stripe_refund_id. Returns the id (existing
// id when it was already recorded). Never throws.
export async function recordRefundCreditNote(
  admin: Admin,
  args: {
    invoiceId: string;
    locationId: string;
    customerId: string | null;
    grossPence: number;
    vatRate: number;
    reason: string | null;
    stripeRefundId: string | null;
    createdBy: string | null;
  },
): Promise<{ creditNoteId: string | null; duplicate: boolean }> {
  try {
    if (args.stripeRefundId) {
      const { data: existing } = await admin
        .from("credit_notes")
        .select("id")
        .eq("stripe_refund_id", args.stripeRefundId)
        .maybeSingle();
      if (existing) return { creditNoteId: (existing as { id: string }).id, duplicate: true };
    }

    const { subtotal, vat, total } = splitGross(args.grossPence, args.vatRate);
    const { count } = await admin
      .from("credit_notes")
      .select("id", { count: "exact", head: true })
      .eq("location_id", args.locationId);
    const creditNumber = `CN-${String((count ?? 0) + 1).padStart(4, "0")}`;

    const { data, error } = await admin
      .from("credit_notes")
      .insert({
        location_id: args.locationId,
        invoice_id: args.invoiceId,
        customer_id: args.customerId,
        credit_number: creditNumber,
        reason: args.reason,
        subtotal,
        vat_amount: vat,
        total,
        stripe_refund_id: args.stripeRefundId,
        created_by: args.createdBy,
      })
      .select("id")
      .maybeSingle();

    if (error) {
      // Unique-violation race on stripe_refund_id → treat as already recorded.
      if (args.stripeRefundId) {
        const { data: ex } = await admin
          .from("credit_notes")
          .select("id")
          .eq("stripe_refund_id", args.stripeRefundId)
          .maybeSingle();
        if (ex) return { creditNoteId: (ex as { id: string }).id, duplicate: true };
      }
      console.error("[credit-notes] insert failed", error);
      return { creditNoteId: null, duplicate: false };
    }
    return { creditNoteId: (data as { id: string } | null)?.id ?? null, duplicate: false };
  } catch (err) {
    console.error("[credit-notes] recordRefundCreditNote threw", err);
    return { creditNoteId: null, duplicate: false };
  }
}

// Re-derive an invoice's refund status from the sum of its credit notes.
export async function recomputeInvoiceRefundStatus(admin: Admin, invoiceId: string): Promise<void> {
  try {
    const { data: inv } = await admin.from("invoices").select("total").eq("id", invoiceId).maybeSingle();
    if (!inv) return;
    const { data: cns } = await admin.from("credit_notes").select("total").eq("invoice_id", invoiceId);
    const refunded = ((cns ?? []) as { total: number }[]).reduce((s, c) => s + (Number(c.total) || 0), 0);
    const invTotal = Number((inv as { total: number }).total) || 0;
    if (refunded <= 0) return;
    const status = refunded + 0.005 >= invTotal ? "refunded" : "part_refunded";
    await admin.from("invoices").update({ status }).eq("id", invoiceId);
  } catch (err) {
    console.error("[credit-notes] recomputeInvoiceRefundStatus threw", err);
  }
}
