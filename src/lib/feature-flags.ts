import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { cacheGet, cacheSet, cacheDel } from "@/lib/redis";

// Platform-wide feature flags. The registry below is the source of truth for
// which flags exist (label/description drive the admin UI); the feature_flags
// table only stores the on/off override + audit trail. Reads fail OPEN to the
// code default when Redis, the DB, or the row is unavailable — a flag lookup
// must never break a request.
//
// Toggled at admin.<root>/admin/feature-flags. Add a flag by adding a registry
// entry here and reading it with isFeatureEnabled() at the consumer.

export type FeatureFlagDef = {
  label: string;
  description: string;
  default: boolean;
};

export const FEATURE_FLAGS = {
  streaming_dashboard: {
    label: "Streaming staff dashboard",
    description:
      "Render the staff dashboard and notifications bell behind Suspense boundaries so the nav chrome paints before the dashboard RPC and notification queries resolve.",
    default: false,
  },
} as const satisfies Record<string, FeatureFlagDef>;

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;

// Short TTL: a toggle should take effect across the estate within ~30s without
// the admin having to wait, while still sparing the DB a read per request. The
// admin action also evicts the key eagerly via invalidateFeatureFlag().
const FLAG_CACHE_TTL_SEC = 30;
const flagKey = (key: FeatureFlagKey) => `flag:${key}`;

// Is the flag on? Redis-cached service-role read; falls open to the registry
// default on any miss/error so a flag lookup can never break a request. Wrapped
// in React cache() so the layout and page reading the same flag in one request
// share a single lookup (one DB hit on a Redis miss, e.g. local dev).
export const isFeatureEnabled = cache(async (key: FeatureFlagKey): Promise<boolean> => {
  const fallback = FEATURE_FLAGS[key].default;

  const cached = await cacheGet<boolean>(flagKey(key));
  if (cached !== null) return cached;

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("feature_flags")
      .select("enabled")
      .eq("key", key)
      .maybeSingle();
    if (error) return fallback;
    const enabled = (data?.enabled as boolean | undefined) ?? fallback;
    await cacheSet(flagKey(key), enabled, FLAG_CACHE_TTL_SEC);
    return enabled;
  } catch {
    return fallback;
  }
});

// Drop a flag's cached value so the next read reflects a just-saved toggle.
export async function invalidateFeatureFlag(key: FeatureFlagKey): Promise<void> {
  await cacheDel(flagKey(key));
}

export type FeatureFlagState = {
  key: FeatureFlagKey;
  label: string;
  description: string;
  enabled: boolean;
  default: boolean;
};

// Every registered flag with its current persisted state, for the admin UI.
// Reads straight from the DB (not the cache) so the operator always sees truth.
// Unknown keys lingering in the table are ignored — the registry is canonical.
export async function listFeatureFlags(): Promise<FeatureFlagState[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("feature_flags").select("key, enabled");
  const overrides = new Map<string, boolean>(
    ((data ?? []) as { key: string; enabled: boolean }[]).map((r) => [r.key, r.enabled]),
  );

  return (Object.keys(FEATURE_FLAGS) as FeatureFlagKey[]).map((key) => {
    const def = FEATURE_FLAGS[key];
    return {
      key,
      label: def.label,
      description: def.description,
      default: def.default,
      enabled: overrides.get(key) ?? def.default,
    };
  });
}
