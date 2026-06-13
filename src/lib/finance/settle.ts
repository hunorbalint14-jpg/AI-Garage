import type { createAdminClient } from "@/lib/supabase/admin";
import { pushPaymentToXero } from "@/lib/xero-sync";
import { logAudit } from "@/lib/audit";

// A completed Bumper application means Bumper has funded the garage upfront,
// so an invoice subject is now settled. Mark it paid (which also stops
// dunning), audit it, and push the payment to Xero — mirroring the Stripe
// paid path, just sourced from finance instead of a card.
//
// Both the return route (customer bounces back) and the reconcile cron fire
// on completion, so this MUST be idempotent: the `.neq("status", "paid")`
// guard means the second caller updates zero rows and does nothing further.

export type CompletedApplication = {
  organization_id: string;
  subject_type: string;
  subject_id: string;
  token: string;
  amount: number;
};

export async function settleInvoiceFromFinance(
  admin: ReturnType<typeof createAdminClient>,
  app: CompletedApplication,
): Promise<void> {
  if (app.subject_type !== "invoice") return;

  const now = new Date().toISOString();
  const { count } = await admin
    .from("invoices")
    .update({ status: "paid", paid_at: now }, { count: "exact" })
    .eq("id", app.subject_id)
    .neq("status", "paid");

  // Already settled (the other caller won the race) — nothing more to do.
  if (!count) return;

  await logAudit({
    organizationId: app.organization_id,
    action: "finance.invoice_settled",
    entityType: "invoice",
    entityId: app.subject_id,
    metadata: { provider: "bumper", finance_token: app.token, amount: app.amount },
  });

  try {
    await pushPaymentToXero({
      invoiceId: app.subject_id,
      amountPence: Math.round(Number(app.amount) * 100),
      paymentDate: now,
      reference: `Bumper ${app.token}`,
    });
  } catch (err) {
    console.error("[finance] xero payment push failed", err);
  }
}
