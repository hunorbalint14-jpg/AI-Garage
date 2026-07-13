"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { parseMarkupRules } from "@/lib/parts-pricing";

// Parts pricing settings (#567): the banded cost→sell markup + target margin
// that drive the AI part-suggestion guardrail. Server re-parses the bands, so
// a malformed client payload can never persist bad pricing.

export type SavePartsPricingResult = { error: string } | { success: true };

export async function savePartsPricing(input: {
  bands: { upToCost: number | null; multiplier: number }[];
  targetPct: number | null;
}): Promise<SavePartsPricingResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "org_settings")) return { error: "Permission denied." };

  const rules = parseMarkupRules(input.bands);
  let targetPct: number | null = null;
  if (input.targetPct !== null && input.targetPct !== undefined) {
    const t = Number(input.targetPct);
    if (!Number.isInteger(t) || t < 0 || t > 95) {
      return { error: "Target margin must be a whole percent between 0 and 95 (leave empty to unset)." };
    }
    targetPct = t;
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({ parts_markup_rules: rules, parts_target_margin_pct: targetPct })
    .eq("id", ctx.organization.id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "settings.update",
    entityType: "organization",
    entityId: ctx.organization.id,
    metadata: { field: "parts_pricing", bands: rules.length, target_margin_pct: targetPct },
  });

  revalidatePath("/staff/settings");
  return { success: true };
}
