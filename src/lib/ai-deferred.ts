import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage, type AiUsageContext } from "@/lib/ai-usage";
import { aiBriefSystemBlock } from "@/lib/ai-profile";

// Deferred-work follow-up drafting (#498 PR 3). One email + one SMS per
// (customer, vehicle) message, naming the actual outstanding repairs — never
// a generic "you have outstanding work" blast. Falls back to the plain
// builders below; AI failure never blocks the send.

const anthropic = new Anthropic();
const MODEL = "claude-haiku-4-5-20251001";

export type FollowupDraftInput = {
  garageName: string; // branch-aware label (garageLabel)
  customerFirstName: string;
  vehicleDescription: string; // "AB19 CDE · Volkswagen Golf"
  items: { description: string; price: number | null; rag: "amber" | "red" | null }[];
  /** 1 = first nudge, 2+ = follow-up to the follow-up (gentler, shorter). */
  stage: number;
  aiBrief?: string | null;
};

const EMAIL_SYSTEM = `You draft short, friendly follow-up emails for UK garages about repair work a customer was advised of but hasn't booked yet.
British English. Under 130 words — warm, helpful, zero pressure tactics. The tone is "we don't want this to catch you out", never salesy.

Rules — STRICT:
- Name each outstanding item and its price where given (£, as provided). Never invent or change a price.
- Urgent items: say plainly they affect safety or the next MOT. Advisory items: worth planning, not an emergency.
- If this is a second follow-up, keep it shorter and acknowledge you've mentioned it before ("Just a gentle reminder…").
- Direct the customer to tap the booking button below. Do NOT ask them to call, phone, or reply; no phone numbers, URLs or contact details in the body — a "Book it in" button is appended automatically.
- Start with "Hi [first name]," — no subject line, no sign-off placeholder.`;

const SMS_SYSTEM = `You draft short SMS follow-ups for UK garages about advised-but-unbooked repair work. Max 140 characters (a booking link is appended after).
British English. Include the customer first name, vehicle registration, the work (summarise if several items) and the garage name.
Do NOT include a phone number or URL, and do not ask them to call or reply — point them to the link below. No sign-off.`;

export async function draftDeferredFollowup(
  input: FollowupDraftInput,
  ctx?: AiUsageContext,
): Promise<{ email: string; sms: string }> {
  const itemsBlock = input.items
    .map(
      (i) =>
        `- ${i.description}${i.price !== null ? ` — £${i.price.toFixed(2)}` : ""}${i.rag === "red" ? " (urgent)" : i.rag === "amber" ? " (advisory)" : ""}`,
    )
    .join("\n");
  const userMsg = `Garage: ${input.garageName}\nCustomer first name: ${input.customerFirstName}\nVehicle: ${input.vehicleDescription}\nFollow-up number: ${input.stage}\n\nOutstanding work:\n${itemsBlock}\n\nEnd by inviting them to book using the button below.`;

  const [emailRes, smsRes] = await Promise.all([
    anthropic.messages.create({
      model: MODEL,
      max_tokens: 350,
      system: [{ type: "text", text: EMAIL_SYSTEM + aiBriefSystemBlock(input.aiBrief), cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userMsg }],
    }),
    anthropic.messages.create({
      model: MODEL,
      max_tokens: 90,
      system: [{ type: "text", text: SMS_SYSTEM + aiBriefSystemBlock(input.aiBrief), cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userMsg }],
    }),
  ]);
  if (ctx) {
    await Promise.all([
      recordAiUsage({ ...ctx, model: MODEL, usage: emailRes.usage }),
      recordAiUsage({ ...ctx, model: MODEL, usage: smsRes.usage }),
    ]);
  }

  const emailBlock = emailRes.content[0];
  const smsBlock = smsRes.content[0];
  return {
    email: emailBlock.type === "text" ? emailBlock.text.trim() : fallbackFollowupEmail(input),
    sms: smsBlock.type === "text" ? smsBlock.text.trim() : fallbackFollowupSms(input),
  };
}

export function fallbackFollowupEmail(input: FollowupDraftInput): string {
  const lines = input.items
    .map((i) => `• ${i.description}${i.price !== null ? ` — £${i.price.toFixed(2)}` : ""}`)
    .join("\n");
  const opener =
    input.stage > 1
      ? `Just a gentle reminder about the work we advised on ${input.vehicleDescription} — it's still outstanding:`
      : `When ${input.vehicleDescription} was last with us, we advised the following work which hasn't been booked in yet:`;
  return `Hi ${input.customerFirstName},\n\n${opener}\n\n${lines}\n\nWe don't want it to catch you out at the next MOT — tap the button below and we'll get it booked in.\n\nThank you,\n${input.garageName}`;
}

export function fallbackFollowupSms(input: FollowupDraftInput): string {
  const first = input.items[0]?.description ?? "advised work";
  const more = input.items.length > 1 ? ` +${input.items.length - 1} more` : "";
  return `Hi ${input.customerFirstName}, ${input.garageName}: ${first}${more} on ${input.vehicleDescription} is still outstanding. Book in a minute:`;
}
