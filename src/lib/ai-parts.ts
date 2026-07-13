import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { recordAiUsage, type AiUsageContext } from "@/lib/ai-usage";
import { getOrgAiBrief, aiBriefSystemBlock } from "@/lib/ai-profile";
import { createAdminClient } from "@/lib/supabase/admin";

// AI parts suggestion (#567). From a job description + vehicle, propose the
// parts likely needed, with fitment caveats — before the catalogue is even
// opened. Mirrors ai-labour: Haiku, org brief injected, usage metered, and a
// plain fallback the caller degrades to (the job screen still adds parts by
// hand). Suggestions are matched to the branch catalogue + priced by the
// caller; this module only proposes.

const anthropic = new Anthropic();
const MODEL = "claude-haiku-4-5-20251001";

export const PART_CATEGORIES = [
  "brakes",
  "filters",
  "suspension",
  "steering",
  "electrical",
  "engine",
  "exhaust",
  "cooling",
  "transmission",
  "tyres",
  "consumables",
  "other",
] as const;

const SuggestionSchema = z.object({
  name: z.string().min(1),
  category: z.string(),
  quantity: z.number().positive(),
  caveat: z.string(),
});

export type PartSuggestion = {
  name: string;
  category: string;
  quantity: number;
  /** Fitment note, or "" — e.g. "confirm 288mm disc, two variants on this chassis". */
  caveat: string;
};

const SYSTEM = `You are a UK automotive parts advisor for a garage.
From a job description and vehicle, list the parts the technician will likely need.
You MUST respond with ONLY a JSON array, no prose, no markdown.

Each element: {"name":"Front brake discs (pair)","category":"brakes","quantity":1,"caveat":"confirm 288mm — two disc variants on this chassis"}

Rules:
- name: the part as a garage would order it, British English (e.g. "Front brake pads", "Oil filter", "5W-30 fully synthetic oil").
- category: one of brakes, filters, suspension, steering, electrical, engine, exhaust, cooling, transmission, tyres, consumables, other.
- quantity: sensible number for the job (pads/discs sold per axle = 1 line qty 1; oil in litres, e.g. 4.5).
- caveat: a SHORT fitment warning (max 12 words) when the part has variants or needs confirming, else "".
- Max 8 parts. Only parts, never labour. Never invent a specific OE number.
- If the job is vague, suggest the common parts for that job and note the caveat.`;

export async function suggestParts(
  jobDescription: string,
  vehicleDescription?: string,
  ctx?: AiUsageContext,
): Promise<PartSuggestion[]> {
  const userMsg = vehicleDescription
    ? `Vehicle: ${vehicleDescription}\nJob: ${jobDescription}`
    : `Job: ${jobDescription}`;

  let system = SYSTEM;
  if (ctx?.organizationId) {
    try {
      system += aiBriefSystemBlock(await getOrgAiBrief(createAdminClient(), ctx.organizationId));
    } catch {
      // best-effort
    }
  }

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 600,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userMsg }],
  });
  if (ctx) await recordAiUsage({ ...ctx, model: MODEL, usage: response.usage });

  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type");
  return parsePartsSuggestions(block.text);
}

// Exported for tests: tolerant of fenced/prose-wrapped JSON; drops malformed
// elements; normalises category to the known set; caps at 8.
export function parsePartsSuggestions(raw: string): PartSuggestion[] {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: PartSuggestion[] = [];
  for (const el of parsed) {
    const r = SuggestionSchema.safeParse(el);
    if (!r.success) continue;
    const category = (PART_CATEGORIES as readonly string[]).includes(r.data.category.toLowerCase())
      ? r.data.category.toLowerCase()
      : "other";
    out.push({
      name: r.data.name.trim().slice(0, 120),
      category,
      quantity: Math.round(r.data.quantity * 100) / 100,
      caveat: r.data.caveat.trim().slice(0, 160),
    });
    if (out.length >= 8) break;
  }
  return out;
}

// Match a suggestion to a catalogue product (pure, unit-tested). Normalised
// token overlap, category as a tie-breaker. Conservative: only matches on a
// strong name overlap so we never mis-price by grabbing the wrong product.
const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const STOP = new Set(["the", "a", "of", "for", "and", "pair", "set", "x", "front", "rear", "left", "right"]);

export function matchProduct<T extends { id: string; name: string; category?: string | null }>(
  suggestion: { name: string; category: string },
  products: T[],
): T | null {
  const sugTokens = norm(suggestion.name).split(" ").filter((t) => t && !STOP.has(t));
  if (sugTokens.length === 0) return null;

  let best: { p: T; score: number } | null = null;
  for (const p of products) {
    const prodTokens = new Set(norm(p.name).split(" ").filter((t) => t && !STOP.has(t)));
    if (prodTokens.size === 0) continue;
    const overlap = sugTokens.filter((t) => prodTokens.has(t)).length;
    if (overlap === 0) continue;
    // Fraction of the suggestion's meaningful words the product covers. The
    // category bonus is a tie-breaker only — it must NOT let a single shared
    // word (e.g. "brake" in discs vs pads) clear the bar on its own.
    let score = overlap / sugTokens.length;
    if ((p.category ?? "").toLowerCase() === suggestion.category) score += 0.15;
    if (!best || score > best.score) best = { p, score };
  }
  // 0.7: a 2-word part needs BOTH words (bonus can't rescue a 1-of-2 overlap),
  // so "brake discs" never mis-maps to a "brake pads" product.
  return best && best.score >= 0.7 ? best.p : null;
}
