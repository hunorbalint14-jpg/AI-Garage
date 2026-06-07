import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage, type AiUsageContext } from "@/lib/ai-usage";

const anthropic = new Anthropic();
const MODEL = "claude-haiku-4-5-20251001";

const EMAIL_REMINDER_SYSTEM = `You draft short, friendly vehicle reminder emails for UK garages.
Write in British English. Keep messages under 120 words — warm but professional.
Include all key vehicle and date details.

Call to action rules — STRICT:
- Direct the customer to click the booking button to book their appointment.
- Do NOT ask the customer to call, phone, ring, or telephone the garage.
- Do NOT ask the customer to reply to the email, respond, or get in touch by message.
- Do NOT include any phone number, email address, or contact details in the body.
- A "Book your appointment" button is automatically appended after your message — do not include any link, URL, or button text yourself.

Return only the email body. Start with "Hi [first name]," — no subject line, no sign-off placeholder.`;

const SMS_REMINDER_SYSTEM = `You draft short SMS reminders for UK garages. Max 130 characters (a booking link is appended after).
British English. Include: customer first name, vehicle registration, reminder type, due date, garage name.

Call to action rules — STRICT:
- Direct the customer to use the link below to book.
- Do NOT ask them to call, phone, or reply.
- Do NOT include a phone number or URL — the booking URL is appended automatically.
- No sign-off or subject line.`;

const EMAIL_CUSTOM_SYSTEM = `You draft short, friendly emails for UK garages communicating with customers.
Write in British English. Under 120 words — warm but professional.

Call to action rules — STRICT:
- Direct the customer to click the button to book their appointment or find out more on the website.
- Do NOT ask the customer to call, phone, or reply to the email.
- Do NOT include any phone number, email address, or contact details.
- A button is automatically appended after your message — do not include any link or URL yourself.

Start with "Hi [first name]," — no subject line, no sign-off placeholder.`;

const SMS_CUSTOM_SYSTEM = `You draft short SMS messages for UK garages. Max 130 characters (a link is appended after).
British English. Include customer name, garage name, and key information.

Call to action rules — STRICT:
- Direct the customer to use the link below.
- Do NOT ask them to call, phone, or reply.
- Do NOT include a phone number or URL — the link is appended automatically.
- No sign-off.`;

export type DraftReminderInput = {
  garageName: string;
  garagePhone: string | null;
  customerFirstName: string;
  registration: string;
  vehicleDescription: string;
  reminderType: "mot" | "service";
  dueDate: string;
};

export type DraftCustomMessageInput = {
  garageName: string;
  garagePhone: string | null;
  customerFirstName: string;
  topic: string;
};

export async function draftReminderMessage(
  input: DraftReminderInput,
  ctx?: AiUsageContext,
): Promise<string> {
  const { garageName, customerFirstName, registration, vehicleDescription, reminderType, dueDate } = input;
  const label = reminderType === "mot" ? "MOT" : "service";

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: [{ type: "text", text: EMAIL_REMINDER_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{
      role: "user",
      content: `Draft a ${label} reminder for:\n\nGarage: ${garageName}\nCustomer first name: ${customerFirstName}\nVehicle: ${vehicleDescription} (${registration})\n${label} due: ${dueDate}\n\nStart with "Hi ${customerFirstName},". End by inviting them to book using the button below — do not write a URL or phone number yourself.`,
    }],
  });
  if (ctx) await recordAiUsage({ ...ctx, model: MODEL, usage: response.usage });

  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type from Claude");
  return block.text.trim();
}

export async function draftSmsReminderMessage(
  input: DraftReminderInput,
  ctx?: AiUsageContext,
): Promise<string> {
  const { garageName, customerFirstName, registration, reminderType, dueDate } = input;
  const label = reminderType === "mot" ? "MOT" : "service";

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 80,
    system: [{ type: "text", text: SMS_REMINDER_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{
      role: "user",
      content: `SMS ${label} reminder: customer ${customerFirstName}, vehicle ${registration}, due ${dueDate}, from ${garageName}. End by pointing them to the booking link below — do not include a phone number or URL.`,
    }],
  });
  if (ctx) await recordAiUsage({ ...ctx, model: MODEL, usage: response.usage });

  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type from Claude");
  return block.text.trim();
}

export async function draftCustomMessage(
  input: DraftCustomMessageInput,
  ctx?: AiUsageContext,
): Promise<{ email: string; sms: string }> {
  const { garageName, customerFirstName, topic } = input;

  const [emailRes, smsRes] = await Promise.all([
    anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: [{ type: "text", text: EMAIL_CUSTOM_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{
        role: "user",
        content: `Email from ${garageName} to customer ${customerFirstName}. Topic: ${topic}. End by inviting them to click the button below to book or find out more — do not include a phone number or URL.`,
      }],
    }),
    anthropic.messages.create({
      model: MODEL,
      max_tokens: 80,
      system: [{ type: "text", text: SMS_CUSTOM_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{
        role: "user",
        content: `SMS from ${garageName} to ${customerFirstName}. Topic: ${topic}. End by pointing to the link below — do not include a phone number or URL.`,
      }],
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
    email: emailBlock.type === "text" ? emailBlock.text.trim() : `Hi ${customerFirstName},\n\n${topic}\n\nRegards, ${garageName}`,
    sms: smsBlock.type === "text" ? smsBlock.text.trim() : `Hi ${customerFirstName}, ${topic}. Contact ${garageName}.`,
  };
}

export type DraftBroadcastInput = {
  garageName: string;
  garagePhone: string | null;
  topic: string;
  needEmail: boolean;
  needSms: boolean;
};

export async function draftBroadcastMessage(
  input: DraftBroadcastInput,
  ctx?: AiUsageContext,
): Promise<{ subject: string; email: string; sms: string }> {
  const { garageName, topic, needEmail, needSms } = input;

  const emailPromise = needEmail
    ? anthropic.messages.create({
        model: MODEL,
        max_tokens: 400,
        system: [{
          type: "text",
          text: `You draft short broadcast marketing emails for UK garages to send to all their customers. British English. Under 120 words. Start with "Dear customer," — warm but professional.

Call to action rules — STRICT:
- Direct readers to click the button to book an appointment or find out more on the website.
- Do NOT ask them to call, phone, ring, or telephone the garage.
- Do NOT ask them to reply to the email or get in touch by message.
- Do NOT include any phone number, email address, or contact details in the body.
- A button is automatically appended after your message — do not include any link or URL yourself.

Output format — exactly two parts separated by a single line containing "---":

SUBJECT: <a short, compelling email subject line, max 60 chars, no quotes, no emoji, no "subject:" prefix in the value>
---
<email body, starting with "Dear customer,">

Do not use the user's raw prompt as the subject — write a fresh, customer-facing subject. Do not include a sign-off placeholder. Do not name a specific customer.`,
          cache_control: { type: "ephemeral" },
        }],
        messages: [{
          role: "user",
          content: `Broadcast email from ${garageName}. Topic: ${topic}. End by inviting the reader to click the button below to book or find out more on the website. Do not include any phone number or URL.`,
        }],
      })
    : Promise.resolve(null);

  const smsPromise = needSms
    ? anthropic.messages.create({
        model: MODEL,
        max_tokens: 80,
        system: [{
          type: "text",
          text: `Draft a broadcast SMS for a UK garage to send to all customers. Max 130 characters (a link is appended after). British English. Include garage name and key info. No customer name, no sign-off.

Call to action rules — STRICT:
- Direct readers to the link below to book or find out more.
- Do NOT ask them to call, phone, or reply.
- Do NOT include a phone number or URL — the link is appended automatically.`,
          cache_control: { type: "ephemeral" },
        }],
        messages: [{
          role: "user",
          content: `Broadcast SMS from ${garageName}. Topic: ${topic}. End by pointing to the link below — do not include a phone number or URL.`,
        }],
      })
    : Promise.resolve(null);

  const [emailRes, smsRes] = await Promise.all([emailPromise, smsPromise]);
  if (ctx) {
    await Promise.all(
      [emailRes, smsRes]
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .map((r) => recordAiUsage({ ...ctx, model: MODEL, usage: r.usage })),
    );
  }

  const fallbackSubject = `News from ${garageName}`;
  const fallbackBody = `Dear customer,\n\n${topic}\n\nRegards, ${garageName}`;
  let subject = needEmail ? fallbackSubject : "";
  let email = needEmail ? fallbackBody : "";

  if (emailRes) {
    const emailBlock = emailRes.content[0];
    const raw = emailBlock.type === "text" ? emailBlock.text.trim() : "";
    if (raw) {
      const parts = raw.split(/\n---\n|\n---\s*$|^---\n/m);
      if (parts.length >= 2) {
        const head = parts[0].trim();
        const body = parts.slice(1).join("\n---\n").trim();
        const subjMatch = head.match(/^subject\s*:\s*(.+)$/im);
        subject = subjMatch ? subjMatch[1].trim().replace(/^["']|["']$/g, "").slice(0, 100) : fallbackSubject;
        email = body || fallbackBody;
      } else {
        const m = raw.match(/^subject\s*:\s*(.+?)\n+([\s\S]+)$/i);
        if (m) {
          subject = m[1].trim().replace(/^["']|["']$/g, "").slice(0, 100);
          email = m[2].trim();
        } else {
          email = raw;
        }
      }
    }
  }

  let sms = "";
  if (smsRes) {
    const smsBlock = smsRes.content[0];
    sms = smsBlock.type === "text"
      ? smsBlock.text.trim()
      : `${topic}. — ${garageName}`;
  }

  return { subject, email, sms };
}

export function fallbackReminderMessage(input: DraftReminderInput): string {
  const { customerFirstName, vehicleDescription, registration, reminderType, dueDate, garageName } = input;
  const label = reminderType === "mot" ? "MOT" : "service";
  return `Hi ${customerFirstName},\n\nThis is a friendly reminder that your ${vehicleDescription} (${registration}) is due for its ${label} on ${dueDate}.\n\nClick the button below to book your appointment with ${garageName}.\n\nThank you for your custom.`;
}

export function fallbackSmsReminderMessage(input: DraftReminderInput): string {
  const { customerFirstName, registration, reminderType, dueDate, garageName } = input;
  const label = reminderType === "mot" ? "MOT" : "service";
  return `Hi ${customerFirstName}, your ${registration} ${label} is due ${dueDate}. Tap the link to book with ${garageName}.`;
}
