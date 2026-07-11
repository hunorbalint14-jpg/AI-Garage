import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage, type AiUsageContext } from "@/lib/ai-usage";
import { aiBriefSystemBlock } from "@/lib/ai-profile";

// Mini-site copywriter (#507 PR 4): strapline + about drafted from the org's
// AI brief, services and branch count. Editable before save, never
// auto-published. Best-effort — callers keep the fields empty on throw/null.

const anthropic = new Anthropic();
const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM = `You write website copy for a UK independent garage's one-page site.
Respond with ONLY a JSON object, no prose: {"strapline":"…","about":"…"}

Rules:
- strapline: ONE sentence, max 100 characters, no exclamation marks, no "welcome to". Concrete and local beats generic ("Family-run MOT centre in Colindale" beats "Your trusted partner").
- about: 2–4 short sentences, max 500 characters, first person plural. Mention what the AI brief actually says (years trading, specialisms, area). Never invent facts, awards, or years. British English.
- No emoji, no ALL CAPS, no marketing clichés ("state of the art", "second to none").`;

export type SiteCopy = { strapline: string; about: string };

export async function draftSiteCopy(
  input: {
    orgName: string;
    branchCount: number;
    services: string[];
    aiBrief?: string | null;
  },
  ctx?: AiUsageContext,
): Promise<SiteCopy | null> {
  const user =
    `Garage: ${input.orgName}\n` +
    `Branches: ${input.branchCount}\n` +
    `Services offered: ${input.services.slice(0, 15).join(", ") || "general servicing and MOTs"}\n\n` +
    `Write the JSON.`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: [{ type: "text", text: SYSTEM + aiBriefSystemBlock(input.aiBrief), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
  });
  if (ctx) await recordAiUsage({ ...ctx, model: MODEL, usage: response.usage });

  const block = response.content[0];
  if (block.type !== "text") return null;
  return parseSiteCopy(block.text);
}

// Exported for tests: tolerant of prose-wrapped JSON; enforces the length
// caps server-side regardless of what the model returned.
export function parseSiteCopy(raw: string): SiteCopy | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { strapline?: unknown; about?: unknown };
    const strapline = typeof parsed.strapline === "string" ? parsed.strapline.trim().slice(0, 160) : "";
    const about = typeof parsed.about === "string" ? parsed.about.trim().slice(0, 2000) : "";
    if (!strapline && !about) return null;
    return { strapline, about };
  } catch {
    return null;
  }
}
