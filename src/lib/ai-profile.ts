import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage, type AiUsageContext } from "@/lib/ai-usage";
import { createAdminClient } from "@/lib/supabase/admin";
import { type AiProfileAnswers } from "@/lib/ai-profile-shared";

// Server-only half of the AI profile module (Claude + DB). The client-safe
// types/options/helpers live in ai-profile-shared.ts and are re-exported here so
// existing server imports of "@/lib/ai-profile" keep working unchanged.
export * from "@/lib/ai-profile-shared";

const anthropic = new Anthropic();
const MODEL = "claude-haiku-4-5-20251001";

const BRIEF_SYSTEM = `You write a concise internal brief that OTHER AI assistants (a customer-facing receptionist, an email/SMS/marketing copywriter, a diagnostic helper, and a labour-time estimator) will read as background context about a single UK garage.

Write 120–180 words of plain text (no markdown, no headings, no bullet symbols). Use clear, instructional sentences in the second person ("This garage…", "Keep the tone…", "Do not offer…"). Cover, where the answers allow: what the garage specialises in and offers; the tone/voice to use in customer messages; services it actively promotes; what it does NOT do (so assistants never promise it); diagnostic/capability notes; parts and tyre policy; how customers should book; and any "never say" rules. Omit anything not provided — never invent facts, prices, or guarantees. British English.`;

// Distil the survey answers into the reusable brief. Best-effort: callers should
// fall back to no brief on throw.
export async function generateAiBrief(
  garageName: string,
  answers: AiProfileAnswers,
  ctx?: AiUsageContext,
): Promise<string> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 500,
    system: [{ type: "text", text: BRIEF_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: `Garage name: ${garageName}\n\nSurvey answers (JSON):\n${JSON.stringify(answers, null, 2)}\n\nWrite the brief.`,
      },
    ],
  });
  if (ctx) await recordAiUsage({ ...ctx, model: MODEL, usage: response.usage });

  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type from Claude");
  return block.text.trim();
}

// Fetch an org's saved brief (null when not onboarded). Used by AI surfaces to
// tailor their output.
export async function getOrgAiBrief(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("organizations")
    .select("ai_brief")
    .eq("id", organizationId)
    .maybeSingle();
  const brief = (data as { ai_brief: string | null } | null)?.ai_brief ?? null;
  return brief && brief.trim() ? brief.trim() : null;
}
