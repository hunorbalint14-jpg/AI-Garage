"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt } from "@/lib/encryption";
import { logAudit } from "@/lib/audit";
import type { FinanceProvider } from "@/lib/finance";

// Owner-gated finance-provider config. Credentials are AES-encrypted before
// they touch the database (same pattern as Xero tokens) and are never sent
// back to the client — the UI only sees whether they're set.

export type FinanceConfigView = {
  provider: FinanceProvider;
  enabled: boolean;
  demoMode: boolean;
  minAmount: number;
  hasCredentials: boolean;
};

export type SaveFinanceConfigInput = {
  provider: FinanceProvider;
  enabled: boolean;
  demoMode: boolean;
  minAmount: number;
  /** Blank = keep the stored credentials. */
  apiKey?: string;
  secret?: string;
};

type SaveResult = { error: string } | { success: true };

export async function saveFinanceConfig(input: SaveFinanceConfigInput): Promise<SaveResult> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") {
    return { error: "Only the organisation owner can manage finance settings." };
  }
  if (input.provider !== "bumper" && input.provider !== "payment_assist") {
    return { error: "Unknown provider." };
  }
  if (!Number.isFinite(input.minAmount) || input.minAmount < 0) {
    return { error: "Minimum amount must be a positive number." };
  }

  const admin = createAdminClient();
  const patch: Record<string, unknown> = {
    organization_id: ctx.organization.id,
    provider: input.provider,
    enabled: input.enabled,
    demo_mode: input.demoMode,
    min_amount: input.minAmount,
    updated_at: new Date().toISOString(),
  };
  if (input.apiKey?.trim()) patch.api_key_encrypted = encrypt(input.apiKey.trim());
  if (input.secret) patch.secret_encrypted = encrypt(input.secret); // never trim — Bumper secrets are byte-exact

  const { error } = await admin
    .from("finance_provider_configs")
    .upsert(patch, { onConflict: "organization_id,provider" });
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    action: "finance.config_update",
    entityType: "finance_provider_config",
    entityId: input.provider,
    metadata: {
      enabled: input.enabled,
      demo_mode: input.demoMode,
      min_amount: input.minAmount,
      credentials_changed: Boolean(input.apiKey?.trim() || input.secret),
    },
  });

  revalidatePath("/staff/settings");
  return { success: true };
}
