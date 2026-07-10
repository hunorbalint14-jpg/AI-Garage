import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { recordAiUsage, type AiUsageContext } from "@/lib/ai-usage";
import { aiBriefSystemBlock } from "@/lib/ai-profile";

// eVHC Phase 3 (#497): tech shorthand → customer-friendly findings. One
// batched call per inspection (all amber/red findings together) so wording
// stays consistent across the report and we pay one round-trip, not one per
// item. Also suggests a repair line per finding, matched against the org's
// services/products price list — the AI only ever picks an entry by number;
// prices come from the catalogue row, never from the model.

const anthropic = new Anthropic();
const MODEL = "claude-haiku-4-5-20251001";

export type FindingInput = {
  id: string;
  section: string;
  label: string;
  rag: "amber" | "red";
  note: string | null;
};

export type CatalogueLine = {
  kind: "service" | "product";
  id: string;
  name: string;
  price: number | null;
};

export type FindingRewrite = {
  id: string;
  summary: string;
  repair: string | null;
  /** 1-based index into the catalogue passed in; null = no clear match. */
  catalogueIndex: number | null;
};

const SYSTEM = `You rewrite UK vehicle technicians' shorthand inspection findings into customer-friendly wording for a digital vehicle health check report.

For every finding you receive, write:
- "summary": 1-3 sentences in British English that a non-mechanic understands — what was found, why it matters (safety, MOT, or the cost of leaving it), and a clear recommendation. Amber findings are advisories that need attention soon; red findings are urgent — safety-critical or a likely MOT failure. Reflect that urgency honestly, without scaremongering.
- "repair": a short repair line suitable for a quote, e.g. "Replace offside front lower suspension arm bush". Provide one whenever the finding calls for work, even when nothing in the price list matches; use null only for purely informational findings.
- "catalogue": the number of ONE entry from the price list that covers the repair, or null when nothing clearly matches. Never force a match.

Rules:
- Expand trade shorthand: osf/nsf/osr/nsr = offside/nearside front/rear, cv = constant velocity, arb = anti-roll bar, and similar.
- Never invent faults, measurements, dates or prices that are not in the finding.
- Do not mention prices in the summary.
- Do not address the customer by name, greet, or sign off — these render as report line items.

Respond with ONLY a JSON object, no markdown fences, in exactly this shape:
{"findings":[{"id":"<finding id>","summary":"...","repair":"..." ,"catalogue":1}]}
Use JSON null for repair/catalogue when not applicable. Include every finding id you were given exactly once.`;

const ResponseSchema = z.object({
  findings: z.array(
    z.object({
      id: z.string(),
      summary: z.string(),
      repair: z.string().nullable().optional(),
      catalogue: z.number().int().nullable().optional(),
    }),
  ),
});

// Pure parse/validation half, split out for unit tests: strips code fences,
// keeps only known finding ids (first occurrence wins), drops out-of-range
// catalogue picks rather than failing the whole batch.
export function parseRewriteResponse(
  raw: string,
  findingIds: string[],
  catalogueSize: number,
): FindingRewrite[] {
  const json = raw.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  const parsed = ResponseSchema.parse(JSON.parse(json));
  const known = new Set(findingIds);
  const seen = new Set<string>();
  const out: FindingRewrite[] = [];
  for (const f of parsed.findings) {
    if (!known.has(f.id) || seen.has(f.id)) continue;
    const summary = f.summary.trim();
    if (!summary) continue;
    seen.add(f.id);
    const idx = f.catalogue ?? null;
    out.push({
      id: f.id,
      summary: summary.slice(0, 1000),
      repair: f.repair?.trim().slice(0, 200) || null,
      catalogueIndex: idx !== null && idx >= 1 && idx <= catalogueSize ? idx : null,
    });
  }
  return out;
}

export async function rewriteInspectionFindings(
  input: {
    vehicle: string;
    findings: FindingInput[];
    catalogue: CatalogueLine[];
    aiBrief?: string | null;
  },
  ctx?: AiUsageContext,
): Promise<FindingRewrite[]> {
  const { vehicle, findings, catalogue } = input;
  if (findings.length === 0) return [];

  const findingsJson = JSON.stringify(
    findings.map((f) => ({
      id: f.id,
      section: f.section,
      item: f.label,
      grade: f.rag === "red" ? "red (urgent)" : "amber (advisory)",
      technician_note: f.note || null,
    })),
  );
  const priceList =
    catalogue.length > 0
      ? catalogue
          .map((c, i) => `[${i + 1}] ${c.name}${c.price !== null ? ` — £${c.price.toFixed(2)}` : ""} (${c.kind})`)
          .join("\n")
      : "No price list available — return null for every catalogue field.";

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: Math.min(4000, 200 + findings.length * 250),
    system: [{ type: "text", text: SYSTEM + aiBriefSystemBlock(input.aiBrief), cache_control: { type: "ephemeral" } }],
    messages: [{
      role: "user",
      content: `Vehicle: ${vehicle || "not specified"}\n\nFindings (JSON):\n${findingsJson}\n\nPrice list:\n${priceList}`,
    }],
  });
  if (ctx) await recordAiUsage({ ...ctx, model: MODEL, usage: response.usage });

  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type from Claude");
  return parseRewriteResponse(block.text, findings.map((f) => f.id), catalogue.length);
}
