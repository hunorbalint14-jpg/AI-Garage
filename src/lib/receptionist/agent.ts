import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage } from "@/lib/ai-usage";
import { getOrgAiBrief, aiBriefSystemBlock } from "@/lib/ai-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { RECEPTIONIST_TOOLS, executeReceptionistTool, type ToolContext } from "./tools";
import { formatBusinessDays } from "@/lib/business-days";

const anthropic = new Anthropic();
// Premium, revenue-generating agent — worth the stronger model. Usage is
// metered per turn into ai_usage_events (feature "receptionist").
const MODEL = "claude-sonnet-4-6";
const MAX_TOOL_ROUNDS = 5;

export type TranscriptMessage = {
  role: "user" | "assistant";
  content: string;
  at: string;
};

export type AgentLocationContext = {
  locationId: string;
  organizationId: string;
  garageName: string;
  locationName: string;
  businessHoursStart: number;
  businessHoursEnd: number;
  /** Open weekdays as JS getDay() numbers (0=Sun..6=Sat). */
  businessDays: number[];
  conversationId: string;
  customerPhone: string;
  channel: "sms" | "whatsapp";
};

export type AgentTurnResult = {
  reply: string;
  bookingId: string | null;
  handedOff: boolean;
};

function systemPrompt(ctx: AgentLocationContext, aiBrief: string | null): string {
  return `You are the receptionist for ${ctx.garageName} (${ctx.locationName}), a UK garage. You're chatting with a customer over ${ctx.channel === "whatsapp" ? "WhatsApp" : "SMS"}.

You can: tell customers about services and prices (list_services), check real appointment availability (check_availability), and book them in (create_booking). Anything else — diagnosis questions, complaints, discounts, changing existing bookings — use hand_off.

Opening hours: ${String(ctx.businessHoursStart).padStart(2, "0")}:00–${String(ctx.businessHoursEnd).padStart(2, "0")}:00.
Open days: ${formatBusinessDays(ctx.businessDays)} — we're closed any other day, so never offer or book one.
Today's date: ${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.

Rules:
- Texts, not essays: 1–3 short sentences per reply. British English, warm and plain.
- Never invent prices or times — always use the tools. Only offer slots check_availability returned.
- Before booking you need: their name, the service, and a confirmed slot. Vehicle registration is helpful but optional.
- Never ask for card details, addresses, or anything sensitive.
- If the customer is angry, confused, or asks for a human: hand_off, don't argue.
- After create_booking succeeds, confirm the day, time and service in one line.${aiBriefSystemBlock(aiBrief)}`;
}

// One conversational turn: customer's message in, agent's reply out. The
// stored transcript is customer-visible text only; tool calls live and die
// inside this function.
export async function runReceptionistTurn(
  transcript: TranscriptMessage[],
  ctx: AgentLocationContext,
): Promise<AgentTurnResult> {
  const toolCtx: ToolContext = {
    locationId: ctx.locationId,
    organizationId: ctx.organizationId,
    conversationId: ctx.conversationId,
    customerPhone: ctx.customerPhone,
    businessHoursStart: ctx.businessHoursStart,
    businessHoursEnd: ctx.businessHoursEnd,
    businessDays: ctx.businessDays,
  };

  const messages: Anthropic.MessageParam[] = transcript.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let bookingId: string | null = null;
  let handedOff = false;

  // Per-org AI brief (services, what we don't do, tone, escalation) — fetched
  // once and injected into the system prompt. Best-effort.
  const aiBrief = await getOrgAiBrief(createAdminClient(), ctx.organizationId).catch(() => null);
  const sysText = systemPrompt(ctx, aiBrief);

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 500,
      system: [{ type: "text", text: sysText, cache_control: { type: "ephemeral" } }],
      tools: RECEPTIONIST_TOOLS,
      messages,
    });

    await recordAiUsage({
      locationId: ctx.locationId,
      organizationId: ctx.organizationId,
      userId: null,
      feature: "receptionist",
      model: MODEL,
      usage: response.usage,
    });

    if (response.stop_reason !== "tool_use") {
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return {
        reply: text || "Sorry, could you say that again?",
        bookingId,
        handedOff,
      };
    }

    // Execute every tool call in this round, then loop.
    messages.push({ role: "assistant", content: response.content });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const outcome = await executeReceptionistTool(
        block.name,
        (block.input ?? {}) as Record<string, unknown>,
        toolCtx,
      );
      if (outcome.bookingId) bookingId = outcome.bookingId;
      if (outcome.handedOff) handedOff = true;
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: outcome.result,
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  // Tool-loop budget exhausted — fail safe to a human.
  if (!handedOff) {
    const outcome = await executeReceptionistTool(
      "hand_off",
      { reason: "Agent exceeded its tool budget" },
      toolCtx,
    );
    handedOff = outcome.handedOff ?? true;
  }
  return {
    reply: "Let me get someone from the garage to help you with that — they'll be in touch shortly.",
    bookingId,
    handedOff,
  };
}
