import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt, isEncrypted } from "@/lib/encryption";
import type { BumperConfig, BumperStatusValue } from "./bumper";

// Provider-agnostic finance plumbing. Bumper is live; Payment Assist is a
// stub until partner API access lands — the quote page and settings UI only
// talk to this module, so adding the second provider is additive.

export type FinanceProvider = "bumper" | "payment_assist";

export type FinanceApplicationStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled"
  | "error";

export type FinanceConfig = {
  provider: FinanceProvider;
  enabled: boolean;
  demoMode: boolean;
  minAmount: number;
  /** Decrypted credentials; null when not yet configured. */
  apiKey: string | null;
  secret: string | null;
};

type ConfigRow = {
  provider: FinanceProvider;
  enabled: boolean;
  demo_mode: boolean;
  min_amount: number;
  api_key_encrypted: string | null;
  secret_encrypted: string | null;
};

function maybeDecrypt(value: string | null): string | null {
  if (!value) return null;
  return isEncrypted(value) ? decrypt(value) : value;
}

/** The org's enabled + credentialed finance config, or null if none usable. */
export async function getActiveFinanceConfig(
  organizationId: string,
): Promise<FinanceConfig | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("finance_provider_configs")
    .select("provider, enabled, demo_mode, min_amount, api_key_encrypted, secret_encrypted")
    .eq("organization_id", organizationId)
    .eq("enabled", true);

  for (const row of (data ?? []) as ConfigRow[]) {
    const apiKey = maybeDecrypt(row.api_key_encrypted);
    const secret = maybeDecrypt(row.secret_encrypted);
    if (!apiKey || !secret) continue;
    // Bumper first; Payment Assist rows are configured but never active
    // until the adapter exists.
    if (row.provider !== "bumper") continue;
    return {
      provider: row.provider,
      enabled: row.enabled,
      demoMode: row.demo_mode,
      minAmount: Number(row.min_amount) || 0,
      apiKey,
      secret,
    };
  }
  return null;
}

export function toBumperConfig(config: FinanceConfig): BumperConfig {
  if (config.provider !== "bumper" || !config.apiKey || !config.secret) {
    throw new Error("Bumper is not configured for this organisation.");
  }
  return { apiKey: config.apiKey, secret: config.secret, demoMode: config.demoMode };
}

/** Map Bumper's status vocabulary onto ours (inprogress → in_progress). */
export function normalizeBumperStatus(status: BumperStatusValue): FinanceApplicationStatus {
  return status === "inprogress" ? "in_progress" : status;
}
