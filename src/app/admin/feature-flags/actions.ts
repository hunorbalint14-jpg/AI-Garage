"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPlatformAdminUser } from "@/lib/platform-admin";
import { logAudit } from "@/lib/audit";
import { FEATURE_FLAGS, invalidateFeatureFlag, type FeatureFlagKey } from "@/lib/feature-flags";

async function requirePlatformAdmin(): Promise<{ id: string; email?: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!(await isPlatformAdminUser(user))) redirect("/admin/login");
  return user!;
}

export type ToggleResult = { error: string } | { success: true; enabled: boolean };

// Flip a platform-wide feature flag. Only known registry keys are writable so a
// forged request can't seed arbitrary rows. Evicts the Redis cache so the change
// takes effect on the next request instead of after the TTL.
export async function setFeatureFlag(key: string, enabled: boolean): Promise<ToggleResult> {
  const actor = await requirePlatformAdmin();

  if (!Object.prototype.hasOwnProperty.call(FEATURE_FLAGS, key)) {
    return { error: "Unknown feature flag." };
  }
  const flagKey = key as FeatureFlagKey;

  const admin = createAdminClient();
  const { error } = await admin
    .from("feature_flags")
    .upsert(
      { key: flagKey, enabled, updated_at: new Date().toISOString(), updated_by: actor.id },
      { onConflict: "key" },
    );
  if (error) return { error: error.message };

  await invalidateFeatureFlag(flagKey);

  await logAudit({
    action: "feature_flag.set",
    actorUserId: actor.id,
    actorEmail: actor.email ?? null,
    entityType: "feature_flag",
    entityId: flagKey,
    metadata: { enabled },
  });

  revalidatePath("/admin/feature-flags");
  return { success: true, enabled };
}
