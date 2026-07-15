"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import {
  deleteAccountingConnection,
  getConnectionStatus,
} from "@/lib/accounting/connection";
import {
  pushCreditNoteToAccounting,
  pushInvoiceToAccounting,
  pushPaymentToAccounting,
} from "@/lib/accounting/sync";

export async function disconnectAccounting(): Promise<{ error: string } | { success: true }> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "xero_integration")) {
    return { error: "Permission denied." };
  }

  const status = await getConnectionStatus(ctx.organization.id);
  const { error } = await deleteAccountingConnection(ctx.organization.id);
  if (error) return { error };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "accounting.disconnect",
    metadata: { provider: status?.provider ?? null },
  });

  revalidatePath("/staff/settings");
  return { success: true };
}

export type RetryResult = {
  attempted: number;
  synced: number;
};

// Re-push everything the health panel counts as missing, oldest first,
// capped per entity type so the action stays interactive. Each push is
// individually idempotent, so re-running is always safe.
const RETRY_CAP = 20;

export async function retryAccountingSync(): Promise<{ error: string } | RetryResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "xero_integration")) {
    return { error: "Permission denied." };
  }
  const status = await getConnectionStatus(ctx.organization.id);
  if (!status) return { error: "No accounting connection." };

  const admin = createAdminClient();
  const orgId = ctx.organization.id;
  let attempted = 0;
  let synced = 0;

  const { data: invoices } = await admin
    .from("invoices")
    .select("id")
    .eq("organization_id", orgId)
    .is("accounting_invoice_id", null)
    .not("is_demo", "is", true)
    .gte("issued_at", status.connectedAt)
    .order("issued_at", { ascending: true })
    .limit(RETRY_CAP);
  for (const row of invoices ?? []) {
    attempted++;
    if (await pushInvoiceToAccounting(row.id as string)) synced++;
  }

  const { data: unpaidSync } = await admin
    .from("invoices")
    .select("id, total, paid_at")
    .eq("organization_id", orgId)
    .is("accounting_payment_id", null)
    .in("status", ["paid", "part_refunded", "refunded"])
    .not("is_demo", "is", true)
    .gte("issued_at", status.connectedAt)
    .order("issued_at", { ascending: true })
    .limit(RETRY_CAP);
  for (const row of unpaidSync ?? []) {
    attempted++;
    const ok = await pushPaymentToAccounting({
      invoiceId: row.id as string,
      amountPence: Math.round(Number(row.total) * 100),
      paymentDate: (row.paid_at as string | null) ?? new Date().toISOString(),
      reference: "Sync retry",
    });
    if (ok) synced++;
  }

  const { data: creditNotes } = await admin
    .from("credit_notes")
    .select("id")
    .eq("organization_id", orgId)
    .is("accounting_credit_note_id", null)
    .gte("created_at", status.connectedAt)
    .order("created_at", { ascending: true })
    .limit(RETRY_CAP);
  for (const row of creditNotes ?? []) {
    attempted++;
    if (await pushCreditNoteToAccounting(row.id as string)) synced++;
  }

  await logAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "accounting.retry_sync",
    metadata: { provider: status.provider, attempted, synced },
  });

  revalidatePath("/staff/settings");
  return { attempted, synced };
}
