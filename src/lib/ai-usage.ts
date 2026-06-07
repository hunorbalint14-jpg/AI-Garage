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

type TokenUsage = { input_tokens?: number | null; output_tokens?: number | null } | null | undefined;

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
  const pricing = AI_MODEL_PRICING[model] ?? DEFAULT_PRICING;
  const pence =
    (input / 1_000_000) * pricing.inputPerMTokPence +
    (output / 1_000_000) * pricing.outputPerMTokPence;
  return Math.round(pence * 10_000) / 10_000;
}

// Fire-and-forget AI usage write. NEVER throws — a logging failure must not
// break the AI feature the user actually invoked (mirrors logAudit). Writes via
// the service-role client; reads are gated by RLS on the table.
export async function recordAiUsage(
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
