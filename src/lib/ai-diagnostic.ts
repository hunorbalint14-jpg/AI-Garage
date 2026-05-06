import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

export type DiagnosisResult = {
  likelyCauses: { cause: string; probability: "likely" | "possible" | "unlikely" }[];
  urgency: "urgent" | "soon" | "monitor";
  urgencyNote: string;
  estimatedCost: string;
  recommendedAction: string;
};

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
): Promise<DiagnosisResult> {
  const userMsg = vehicleDescription
    ? `Vehicle: ${vehicleDescription}\nSymptom: ${symptom}`
    : `Symptom: ${symptom}`;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userMsg }],
  });

  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type");

  const text = block.text.trim();
  // Strip markdown code fences if present
  const json = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();

  return JSON.parse(json) as DiagnosisResult;
}
