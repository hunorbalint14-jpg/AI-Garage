import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Per-model token pricing, used to turn Anthropic token counts into a £ figure
// for the platform-admin dashboard. Rates are in PENCE per MILLION tokens.
//
// IMPORTANT: these are GBP estimates derived from Anthropic's USD list prices —
// Claude Haiku 4.5 is $1 / MTok input, $5 / MTok output — converted at roughly
// 0.79 GBP/USD. Anthropic bills in USD; this is a cost *estimate* for oversight,
// not an invoice. Re-confirm the list price + FX and update these numbers.
type ModelPricing = { inputPerMTokPence: number; outputPerMTokPence: number };

export const AI_MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-haiku-4-5-20251001": { inputPerMTokPence: 79, outputPerMTokPence: 395 },
};

// Fallback for an un-mapped model id: assume the Haiku rate so a new model is
// estimated rather than silently counted as £0. Logged so we notice the gap.
const DEFAULT_PRICING: ModelPricing = { inputPerMTokPence: 79, outputPerMTokPence: 395 };

type TokenUsage =
  | {
      input_tokens?: number | null;
      output_tokens?: number | null;
      cache_creation_input_tokens?: number | null;
      cache_read_input_tokens?: number | null;
    }
  | null
  | undefined;

export type AiUsageContext = {
  locationId: string;
  organizationId?: string | null;
  userId?: string | null;
  /** Short feature key, e.g. "reminder_draft", "labour_estimate", "diagnostic". */
  feature: string;
};

// Pure: tokens → estimated £ cost in pence (4 dp). Unknown model falls back to
// the default rate.
export function costPence(model: string, usage: TokenUsage): number {
  const input = usage?.input_tokens ?? 0;
  const output = usage?.output_tokens ?? 0;
  // Anthropic reports prompt-cache tokens SEPARATELY from input_tokens: cache
  // writes bill at 1.25× the input rate (5-minute ephemeral cache) and cache
  // reads at 0.1×. Counting them at those multipliers keeps the estimate right
  // if caching ever activates. Re-confirm the multipliers alongside the list
  // prices above.
  const cacheWrite = usage?.cache_creation_input_tokens ?? 0;
  const cacheRead = usage?.cache_read_input_tokens ?? 0;
  const pricing = AI_MODEL_PRICING[model] ?? DEFAULT_PRICING;
  const pence =
    ((input + cacheWrite * 1.25 + cacheRead * 0.1) / 1_000_000) * pricing.inputPerMTokPence +
    (output / 1_000_000) * pricing.outputPerMTokPence;
  return Math.round(pence * 10_000) / 10_000;
}

// Fire-and-forget AI usage write. NEVER throws — a logging failure must not
// break the AI feature the user actually invoked (mirrors logAudit). Writes via
// the service-role client; reads are gated by RLS on the table.
//
// Deferred via next/server after(): the insert runs once the response has been
// sent, so the user-facing AI action doesn't pay an extra DB round-trip. On
// Vercel this rides waitUntil, so the write still completes after the function
// responds. Outside a request scope (scripts, tests) after() throws — fall
// back to writing inline.
export async function recordAiUsage(
  args: AiUsageContext & { model: string; usage: TokenUsage },
): Promise<void> {
  try {
    after(() => writeUsageEvent(args));
  } catch {
    await writeUsageEvent(args);
  }
}

async function writeUsageEvent(
  args: AiUsageContext & { model: string; usage: TokenUsage },
): Promise<void> {
  try {
    if (!AI_MODEL_PRICING[args.model]) {
      console.warn("[ai-usage] unmapped model, using default rate", { model: args.model });
    }
    const admin = createAdminClient();
    await admin.from("ai_usage_events").insert({
      location_id: args.locationId,
      organization_id: args.organizationId ?? null,
      user_id: args.userId ?? null,
      feature: args.feature,
      model: args.model,
      input_tokens: args.usage?.input_tokens ?? 0,
      output_tokens: args.usage?.output_tokens ?? 0,
      cost_pence: costPence(args.model, args.usage),
    });
  } catch (err) {
    console.error("[ai-usage] record failed", { feature: args.feature, err });
  }
}
