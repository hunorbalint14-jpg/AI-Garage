"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { isLikelyUkVatNumber } from "@/lib/vat";
import { logAudit } from "@/lib/audit";

export type VatSettingsResult = { error: string } | { success: true };

const BUSINESS_STRUCTURES = ["sole_trader", "partnership", "limited_company"] as const;

// Org-level VAT registration + business structure, and the active branch's
// invoice prefix + MOT arrangement (#451, MTD readiness). Owner only —
// these change what prints on legal documents and how tax is coded.
export async function updateVatSettings(formData: FormData): Promise<VatSettingsResult> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner") return { error: "Only the account owner can change VAT settings." };
  const admin = createAdminClient();

  const vatRegistered = formData.get("vatRegistered") !== "false";
  const vatNumberRaw = (formData.get("vatNumber") as string | null)?.trim() ?? "";
  const vatNumber = vatRegistered && vatNumberRaw ? vatNumberRaw.slice(0, 20) : null;
  // Format-only check (9/12 digits or GD/HA body, optional GB prefix) — a
  // wrong VAT number on invoices is a legal problem, not a cosmetic one.
  if (vatNumber && !isLikelyUkVatNumber(vatNumber)) {
    return { error: "That doesn't look like a UK VAT number (e.g. GB123456789)." };
  }
  const structureRaw = (formData.get("businessStructure") as string | null)?.trim() ?? "";
  const businessStructure = (BUSINESS_STRUCTURES as readonly string[]).includes(structureRaw)
    ? structureRaw
    : null;
  const prefixRaw = (formData.get("invoicePrefix") as string | null)?.trim() ?? "";
  const invoicePrefix = prefixRaw ? prefixRaw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) : null;
  const motSubcontracted = formData.get("motSubcontracted") === "true";

  const { error: orgErr } = await admin
    .from("organizations")
    .update({ vat_registered: vatRegistered, vat_number: vatNumber, business_structure: businessStructure })
    .eq("id", ctx.organization.id);
  if (orgErr) return { error: orgErr.message };

  const { error: locErr } = await admin
    .from("locations")
    .update({ invoice_prefix: invoicePrefix, mot_subcontracted: motSubcontracted })
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
    metadata: {
      vat_registered: vatRegistered,
      vat_number: vatNumber,
      business_structure: businessStructure,
      invoice_prefix: invoicePrefix,
      mot_subcontracted: motSubcontracted,
      location_id: ctx.location.id,
    },
  });

  revalidatePath("/staff/settings");
  return { success: true };
}
