import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage, type AiUsageContext } from "@/lib/ai-usage";
import { aiBriefSystemBlock } from "@/lib/ai-profile";
import { TARGET_FIELDS, type ColumnMapping, type ImportKind } from "@/lib/import-engine";

// AI column mapping (#505 PR 4): given a CSV's headers and five sample rows,
// propose which column feeds which target field, with a confidence per
// proposal. High/medium proposals pre-fill the wizard's dropdowns; low ones
// render as hints only. The human always confirms — AI never commits an
// import. Best-effort: callers fall back to the alias auto-map on throw/null.
// Only headers + 5 sample rows ever leave the server — never the whole file.

const anthropic = new Anthropic();
const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM = `You map CSV columns from a UK garage-management export onto target fields.
Respond with ONLY a JSON object, no prose: {"mappings":[{"target":"<target key>","source":"<column header>","confidence":"high"|"medium"|"low"}]}

Rules:
- Only use target keys and column headers from the lists given. Omit targets you can't place.
- Judge from header names AND the sample values (e.g. a column of "AB12 CDE" values is a UK registration whatever it's called).
- "high" = certain, "medium" = probable, "low" = a guess worth flagging.
- Dates in samples are UK dd/mm/yyyy unless clearly ISO. Money may carry £ and commas.
- One source column per target; never map the same source twice.`;

export type MappingSuggestion = Record<string, { source: string; confidence: "high" | "medium" | "low" }>;

export type SuggestedMapping = {
  /** Ready to apply: high + medium confidence proposals only. */
  mapping: ColumnMapping;
  /** Everything proposed, including low-confidence hints, for the chips. */
  suggestions: MappingSuggestion;
};

export async function suggestImportMapping(
  input: {
    kind: ImportKind;
    headers: string[];
    /** Up to 5 rows, keyed by normalised header. */
    sampleRows: Record<string, string>[];
    aiBrief?: string | null;
  },
  ctx?: AiUsageContext,
): Promise<SuggestedMapping | null> {
  const targets = TARGET_FIELDS[input.kind].map((f) => ({ key: f.key, label: f.label, required: f.required }));
  const samples = input.sampleRows.slice(0, 5);

  const user =
    `Import kind: ${input.kind}\n\n` +
    `Target fields:\n${JSON.stringify(targets)}\n\n` +
    `Column headers:\n${JSON.stringify(input.headers)}\n\n` +
    `Sample rows (up to 5):\n${JSON.stringify(samples)}\n\n` +
    `Return the JSON mapping.`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 700,
    system: [{ type: "text", text: SYSTEM + aiBriefSystemBlock(input.aiBrief), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
  });
  if (ctx) await recordAiUsage({ ...ctx, model: MODEL, usage: response.usage });

  const block = response.content[0];
  if (block.type !== "text") return null;
  return parseSuggestion(block.text, input.kind, input.headers);
}

// Exported for tests: defensive parse — unknown targets/headers dropped,
// duplicate sources dropped (first wins), low confidence never enters the
// applied mapping.
export function parseSuggestion(raw: string, kind: ImportKind, headers: string[]): SuggestedMapping | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: { mappings?: unknown };
  try {
    parsed = JSON.parse(match[0]) as { mappings?: unknown };
  } catch {
    return null;
  }
  if (!Array.isArray(parsed.mappings)) return null;

  const validTargets = new Set(TARGET_FIELDS[kind].map((f) => f.key));
  const headerSet = new Set(headers);
  const usedSources = new Set<string>();
  const suggestions: MappingSuggestion = {};
  const mapping: ColumnMapping = {};
  for (const f of TARGET_FIELDS[kind]) mapping[f.key] = null;

  for (const item of parsed.mappings as { target?: unknown; source?: unknown; confidence?: unknown }[]) {
    const target = typeof item.target === "string" ? item.target : null;
    const source = typeof item.source === "string" ? item.source : null;
    const confidence =
      item.confidence === "high" || item.confidence === "medium" || item.confidence === "low" ? item.confidence : "low";
    if (!target || !source) continue;
    if (!validTargets.has(target) || !headerSet.has(source)) continue;
    if (suggestions[target] || usedSources.has(source)) continue;
    suggestions[target] = { source, confidence };
    usedSources.add(source);
    if (confidence !== "low") mapping[target] = source;
  }

  return Object.keys(suggestions).length > 0 ? { mapping, suggestions } : null;
}
