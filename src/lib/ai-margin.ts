import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage, type AiUsageContext } from "@/lib/ai-usage";
import { aiBriefSystemBlock } from "@/lib/ai-profile";
import type { PeriodMargin } from "@/lib/margin";

// Weekly-digest margin note (#502 PR 2): two or three plain sentences an
// owner can act on, comparing the last 30 days to the 30 before and calling
// out the category dragging margin. Best-effort — callers skip the section
// on throw or null.

const anthropic = new Anthropic();
const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM = `You write a two-to-three sentence profitability note for a UK garage owner's weekly email digest.
British English, plain language, numbers as given (£, %). No greeting, no sign-off, no bullet points, no headers.

Rules:
- Lead with the headline movement (margin up/down X points vs the prior period, or steady).
- If a category is clearly dragging margin, name it with its number and suggest ONE concrete, sensible action (e.g. review fitted pricing, check supplier cost).
- Never invent figures, never mention data you weren't given, never exaggerate. If figures are incomplete, say what would unlock them in half a sentence.`;

export type MarginNoteInput = {
  current: PeriodMargin;
  previous: PeriodMargin;
  aiBrief?: string | null;
};

function describe(p: PeriodMargin): string {
  return JSON.stringify({
    jobs: p.jobs,
    sold_ex_vat: p.sell,
    gross_profit: p.grossProfit,
    gross_margin_pct: p.grossMarginPct,
    effective_labour_rate: p.effectiveLabourRate,
    parts_margin_pct: p.partsMarginPct,
    part_lines_missing_cost: p.unknownPartCostCount,
    by_category: p.byCategory.map((c) => ({ category: c.category, sold: c.sell, margin_pct: c.marginPct })),
  });
}

export async function draftMarginNote(input: MarginNoteInput, ctx?: AiUsageContext): Promise<string | null> {
  if (input.current.jobs === 0) return null;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 200,
    system: [{ type: "text", text: SYSTEM + aiBriefSystemBlock(input.aiBrief), cache_control: { type: "ephemeral" } }],
    messages: [{
      role: "user",
      content: `Last 30 days:\n${describe(input.current)}\n\nPrior 30 days:\n${describe(input.previous)}\n\nWrite the note.`,
    }],
  });
  if (ctx) await recordAiUsage({ ...ctx, model: MODEL, usage: response.usage });

  const block = response.content[0];
  if (block.type !== "text") return null;
  const text = block.text.trim();
  return text || null;
}
