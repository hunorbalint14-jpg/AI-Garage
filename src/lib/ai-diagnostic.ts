import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { recordAiUsage, type AiUsageContext } from "@/lib/ai-usage";
import { getOrgAiBrief, aiBriefSystemBlock } from "@/lib/ai-profile";
import { createAdminClient } from "@/lib/supabase/admin";

const anthropic = new Anthropic();
const MODEL = "claude-haiku-4-5-20251001";

// Validate the model's JSON before it reaches the UI — an unchecked cast would
// happily render a malformed response.
const DiagnosisSchema = z.object({
  likelyCauses: z
    .array(
      z.object({
        cause: z.string(),
        probability: z.enum(["likely", "possible", "unlikely"]),
      }),
    )
    .min(1),
  urgency: z.enum(["urgent", "soon", "monitor"]),
  urgencyNote: z.string(),
  estimatedCost: z.string(),
  recommendedAction: z.string(),
});

export type DiagnosisResult = z.infer<typeof DiagnosisSchema>;

const SYSTEM = `You are an expert UK automotive diagnostic assistant for a garage.
A customer has described a symptom with their vehicle. Provide a concise, accurate diagnosis.

Respond ONLY with valid JSON in this exact format:
{
  "likelyCauses": [
    { "cause": "string", "probability": "likely" | "possible" | "unlikely" }
  ],
  "urgency": "urgent" | "soon" | "monitor",
  "urgencyNote": "one sentence explaining urgency",
  "estimatedCost": "£X–£X (parts and labour)",
  "recommendedAction": "one clear sentence on what the customer should do"
}

Rules:
- urgency "urgent" = unsafe to drive / risk of breakdown
- urgency "soon" = should be seen within 2 weeks
- urgency "monitor" = non-critical, next service is fine
- Keep estimatedCost as realistic UK garage prices
- List 2-4 likely causes, ranked by probability
- British English throughout`;

export async function runDiagnostic(
  symptom: string,
  vehicleDescription?: string,
  ctx?: AiUsageContext,
): Promise<DiagnosisResult> {
  const userMsg = vehicleDescription
    ? `Vehicle: ${vehicleDescription}\nSymptom: ${symptom}`
    : `Symptom: ${symptom}`;

  // Tailor to the garage's capabilities/cost realism when we know the org.
  let system = SYSTEM;
  if (ctx?.organizationId) {
    try {
      system += aiBriefSystemBlock(await getOrgAiBrief(createAdminClient(), ctx.organizationId));
    } catch {
      // best-effort — fall back to the base prompt
    }
  }

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 500,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userMsg }],
  });
  if (ctx) await recordAiUsage({ ...ctx, model: MODEL, usage: response.usage });

  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type");

  const text = block.text.trim();
  // Strip markdown code fences if present
  const json = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();

  return DiagnosisSchema.parse(JSON.parse(json));
}
