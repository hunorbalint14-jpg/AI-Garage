import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const SYSTEM = `You are an assistant for UK garage mechanics. The mechanic dictates freeform notes about a job they just completed or are working on. Your task: extract a clean summary and a structured list of job line items.

You MUST respond with ONLY a valid JSON object. No prose, no markdown.

Required JSON shape:
{
  "summary": "1-2 sentence professional summary of the work, suitable for the job card and customer-facing invoice",
  "items": [
    {"description": "specific part or labour", "type": "part" | "labour" | "other", "quantity": number}
  ]
}

Rules:
- summary: concise, professional, written from the garage's perspective. No mechanic slang.
- items: split parts and labour into separate items. One item per distinct part or labour activity.
- description: clear, specific (e.g. "Rear brake pads — front left" not just "pads"). Suitable for an invoice line.
- type: "part" for physical components, "labour" for time-based work, "other" for misc consumables/fees.
- quantity: positive number. For labour, use hours (e.g. 2.5). For parts, use unit count (e.g. 1, 4).
- Do NOT estimate prices — that comes later.
- If the mechanic mentions hours, create a labour line for that duration.
- If something is unclear, make a reasonable inference rather than asking.
- If the transcript is too short or unclear to extract anything, return: {"summary":"","items":[]}`;

export type StructuredJob = {
  summary: string;
  items: { description: string; type: "part" | "labour" | "other"; quantity: number }[];
};

export async function structureVoiceNotes(
  transcript: string,
  vehicleDescription?: string,
): Promise<StructuredJob> {
  const userMsg = vehicleDescription
    ? `Vehicle: ${vehicleDescription}\n\nMechanic notes:\n${transcript}`
    : `Mechanic notes:\n${transcript}`;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1000,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userMsg }],
  });

  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type");

  const json = block.text.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  const result = JSON.parse(json) as StructuredJob;

  if (typeof result.summary !== "string" || !Array.isArray(result.items)) {
    throw new Error("Invalid response shape");
  }
  // Validate item shapes
  result.items = result.items
    .filter((i) => i && typeof i.description === "string" && typeof i.quantity === "number" && i.quantity > 0)
    .map((i) => ({
      description: i.description.trim(),
      type: ["part", "labour", "other"].includes(i.type) ? i.type : "other",
      quantity: Math.round(i.quantity * 100) / 100,
    }));
  return result;
}
