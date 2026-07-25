"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { encrypt } from "@/lib/encryption";
import { isValidPunchoutTemplate } from "@/lib/suppliers/punchout";
import { isConnectorKind } from "@/lib/suppliers/types";

type ActionResult = { error: string } | { success: true };

export type SupplierIntegrationInput = {
  kind: string;
  enabled: boolean;
  punchoutUrlTemplate: string | null;
  orderEmail: string | null;
  accountNumber: string | null;
  /**
   * Write-only. Omit to leave the stored credentials untouched; pass null to
   * clear them. Values are AES-encrypted here and never read back out to the
   * browser — the UI only ever learns whether something is set.
   */
  credentials?: Record<string, string> | null;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Save (or create) a supplier's ordering config. Mirrors the finance/Xero
// posture: secrets in, never out.
export async function saveSupplierIntegration(
  supplierId: string,
  input: SupplierIntegrationInput,
): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "products")) return { error: "Permission denied." };

  if (!isConnectorKind(input.kind)) return { error: "Unknown ordering method." };

  const punchout = input.punchoutUrlTemplate?.trim() || null;
  if (punchout && !isValidPunchoutTemplate(punchout)) {
    return { error: "The catalogue link must be a full http(s) URL, e.g. https://factor.example/search?q={query}" };
  }

  const orderEmail = input.orderEmail?.trim() || null;
  if (orderEmail && !EMAIL_RE.test(orderEmail)) return { error: "Enter a valid order email address." };

  const admin = createAdminClient();

  // Tenancy check — the supplier must belong to the active branch.
  const { data: supplier } = await admin
    .from("suppliers")
    .select("id, name")
    .eq("id", supplierId)
    .eq("location_id", ctx.location.id)
    .maybeSingle();
  if (!supplier) return { error: "Supplier not found." };

  const row: Record<string, unknown> = {
    supplier_id: supplierId,
    location_id: ctx.location.id,
    kind: input.kind,
    enabled: input.enabled,
    punchout_url_template: punchout,
    order_email: orderEmail,
    account_number: input.accountNumber?.trim() || null,
    updated_at: new Date().toISOString(),
  };

  // Only touch the credentials column when the caller said something about it:
  // omitted = leave, null = clear, object = replace.
  let credentialChange: "unchanged" | "set" | "cleared" = "unchanged";
  if (input.credentials !== undefined) {
    const entries = Object.entries(input.credentials ?? {}).filter(([, v]) => (v ?? "").trim() !== "");
    if (entries.length > 0) {
      row.credentials = encrypt(JSON.stringify(Object.fromEntries(entries)));
      credentialChange = "set";
    } else {
      row.credentials = null;
      credentialChange = "cleared";
    }
  }

  const { error } = await admin.from("supplier_integrations").upsert(row, { onConflict: "supplier_id" });
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "supplier_integration.update",
    entityType: "supplier",
    entityId: supplierId,
    // Never log credential values — only that they moved.
    metadata: {
      kind: input.kind,
      enabled: input.enabled,
      punchout: !!punchout,
      order_email: !!orderEmail,
      credentials: credentialChange,
    },
  });

  revalidatePath("/staff/suppliers");
  revalidatePath("/staff/purchase-orders");
  return { success: true };
}

// Remove the ordering config entirely (back to "not set up").
export async function deleteSupplierIntegration(supplierId: string): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "products")) return { error: "Permission denied." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("supplier_integrations")
    .delete()
    .eq("supplier_id", supplierId)
    .eq("location_id", ctx.location.id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "supplier_integration.delete",
    entityType: "supplier",
    entityId: supplierId,
  });

  revalidatePath("/staff/suppliers");
  revalidatePath("/staff/purchase-orders");
  return { success: true };
}
