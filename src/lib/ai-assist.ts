import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage, type AiUsageContext } from "@/lib/ai-usage";
import { aiBriefSystemBlock } from "@/lib/ai-profile";
import { type AssistChannel } from "@/lib/ai-assist-shared";

export * from "@/lib/ai-assist-shared";

const anthropic = new Anthropic();
const MODEL = "claude-haiku-4-5-20251001";

const ASSIST_SYSTEM = `You rewrite customer-facing messages on behalf of UK garage staff. British English.

Rules — STRICT:
- Apply the requested change and nothing else.
- Preserve every fact exactly: names, registrations, dates, times, prices, and any links or contact details the original contains.
- Do NOT add links, URLs, phone numbers, contact details, offers, discounts, or guarantees that are not in the original.
- Keep placeholders like {{first_name}} untouched if present.
- Return ONLY the rewritten message — no preamble, no quotes, no commentary.`;

const CHANNEL_RULES: Record<AssistChannel, string> = {
  email: "The text is the body of a customer email. Keep it under 150 words unless the original is longer.",
  sms: "The text is an SMS. Aim for 130 characters or fewer (a link may be appended automatically after it).",
  generic: "The text is a short customer-facing note.",
};

const MAX_TOKENS: Record<AssistChannel, number> = {
  email: 400,
  sms: 120,
  generic: 400,
};

export type AssistRewriteInput = {
  text: string;
  instruction: string;
  channel: AssistChannel;
  garageName: string;
  aiBrief?: string | null;
};

// Rewrite the user's own draft per their instruction. Unlike the draft-*
// helpers this never generates from scratch — the staff member's text is the
// source of truth and facts must survive the rewrite.
export async function assistRewrite(
  input: AssistRewriteInput,
  ctx?: AiUsageContext,
): Promise<string> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS[input.channel],
    system: [{
      type: "text",
      text: `${ASSIST_SYSTEM}\n\n${CHANNEL_RULES[input.channel]}${aiBriefSystemBlock(input.aiBrief)}`,
      cache_control: { type: "ephemeral" },
    }],
    messages: [{
      role: "user",
      content: `Garage: ${input.garageName}\n\nRequested change: ${input.instruction}\n\nMessage to rewrite:\n<<<\n${input.text}\n>>>`,
    }],
  });
  if (ctx) await recordAiUsage({ ...ctx, model: MODEL, usage: response.usage });

  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type from Claude");
  const out = block.text.trim();
  if (!out) throw new Error("Empty rewrite from Claude");
  return out;
}
