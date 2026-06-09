import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { recordAiUsage, type AiUsageContext } from "@/lib/ai-usage";

const anthropic = new Anthropic();
const MODEL = "claude-haiku-4-5-20251001";

const LabourEstimateSchema = z.object({
  hours: z.number().positive(),
  note: z.string(),
});

const SYSTEM = `You are a UK automotive labour time estimator.
You MUST ALWAYS respond with ONLY a JSON object. Never write prose, never ask for clarification.
If the job is unclear, make a reasonable estimate based on what is described.

Required JSON format (nothing else, no markdown):
{"hours":1.5,"note":"short caveat"}

Rules:
- hours: positive decimal, round to nearest 0.25 (e.g. 0.5, 1.0, 1.25, 2.5)
- note: max 8 words explaining the estimate
- Include ramp time and associated checks in the estimate
- If truly impossible to estimate, return {"hours":1.0,"note":"Adjust based on actual job scope"}`;

export async function estimateLabourTime(
  description: string,
  vehicleDescription?: string,
  ctx?: AiUsageContext,
): Promise<{ hours: number; note: string }> {
  const userMsg = vehicleDescription
    ? `Vehicle: ${vehicleDescription}\nJob: ${description}`
    : `Job: ${description}`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 100,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userMsg }],
  });
  if (ctx) await recordAiUsage({ ...ctx, model: MODEL, usage: response.usage });

  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type");

  const json = block.text.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  const result = LabourEstimateSchema.parse(JSON.parse(json));

  return { hours: Math.round(result.hours * 4) / 4, note: result.note };
}
