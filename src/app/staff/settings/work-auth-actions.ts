"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

// Work-authorisation settings (#503 PR 4): the org's CURRENT T&Cs (each
// artefact snapshots its own copy — editing here never rewrites history)
// and the variation tolerance the exceeds-warning uses.

export type SaveWorkAuthResult = { error: string } | { success: true };

export async function saveWorkAuthSettings(formData: FormData): Promise<SaveWorkAuthResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "org_settings")) return { error: "Permission denied." };

  const terms = ((formData.get("terms") as string | null) ?? "").trim().slice(0, 10_000) || null;
  const rawPct = ((formData.get("thresholdPct") as string | null) ?? "").trim();
  const pct = Number(rawPct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    return { error: "Variation tolerance must be between 0 and 100%." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({ authorisation_terms: terms, variation_threshold_pct: Math.round(pct * 100) / 100 })
    .eq("id", ctx.organization.id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "settings.update",
    entityType: "organization",
    entityId: ctx.organization.id,
    metadata: { field: "work_authorisation", threshold_pct: pct, terms_length: terms?.length ?? 0 },
  });

  revalidatePath("/staff/settings");
  return { success: true };
}
