"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import {
  deleteAccountingConnection,
  getConnectionStatus,
} from "@/lib/accounting/connection";
import { runAccountingBackfill } from "@/lib/accounting/backfill";

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

// Re-push everything the health panel counts as missing — the sweep
// itself lives in src/lib/accounting/backfill.ts, shared with the
// background retry cron. Capped per entity type so the action stays
// interactive; each push is individually idempotent.
export async function retryAccountingSync(): Promise<{ error: string } | RetryResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "xero_integration")) {
    return { error: "Permission denied." };
  }
  const status = await getConnectionStatus(ctx.organization.id);
  if (!status) return { error: "No accounting connection." };

  const { attempted, synced } = await runAccountingBackfill(ctx.organization.id, status.connectedAt);

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "accounting.retry_sync",
    metadata: { provider: status.provider, attempted, synced },
  });

  revalidatePath("/staff/settings");
  return { attempted, synced };
}
