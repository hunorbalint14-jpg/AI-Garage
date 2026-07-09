"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

export type VatSettingsResult = { error: string } | { success: true };

// Org-level VAT registration + the active branch's invoice prefix (#451).
// Owner only — these change what prints on legal documents.
export async function updateVatSettings(formData: FormData): Promise<VatSettingsResult> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner") return { error: "Only the account owner can change VAT settings." };
  const admin = createAdminClient();

  const vatRegistered = formData.get("vatRegistered") !== "false";
  const vatNumberRaw = (formData.get("vatNumber") as string | null)?.trim() ?? "";
  const vatNumber = vatRegistered && vatNumberRaw ? vatNumberRaw.slice(0, 20) : null;
  const prefixRaw = (formData.get("invoicePrefix") as string | null)?.trim() ?? "";
  const invoicePrefix = prefixRaw ? prefixRaw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) : null;

  const { error: orgErr } = await admin
    .from("organizations")
    .update({ vat_registered: vatRegistered, vat_number: vatNumber })
    .eq("id", ctx.organization.id);
  if (orgErr) return { error: orgErr.message };

  const { error: locErr } = await admin
    .from("locations")
    .update({ invoice_prefix: invoicePrefix })
    .eq("id", ctx.location.id)
    .eq("organization_id", ctx.organization.id);
  if (locErr) return { error: locErr.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "settings.vat",
    entityType: "organization",
    entityId: ctx.organization.id,
    metadata: { vat_registered: vatRegistered, vat_number: vatNumber, invoice_prefix: invoicePrefix, location_id: ctx.location.id },
  });

  revalidatePath("/staff/settings");
  return { success: true };
}
