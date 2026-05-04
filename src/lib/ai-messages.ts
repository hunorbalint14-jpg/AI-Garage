import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const EMAIL_REMINDER_SYSTEM = `You draft short, friendly vehicle reminder emails for UK garages.
Write in British English. Keep messages under 120 words — warm but professional.
Include all key vehicle and date details. End with a clear call to action (call to book in or reply to this email).
Return only the email body. Start with "Hi [first name]," — no subject line, no sign-off placeholder.`;

const SMS_REMINDER_SYSTEM = `You draft short SMS reminders for UK garages. Max 160 characters. British English.
Include: customer first name, vehicle registration, reminder type, due date, garage name. No sign-off or subject line.`;

const EMAIL_CUSTOM_SYSTEM = `You draft short, friendly emails for UK garages communicating with customers.
Write in British English. Under 120 words — warm but professional.
Start with "Hi [first name]," — no subject line, no sign-off placeholder. End with a clear call to action.`;

const SMS_CUSTOM_SYSTEM = `You draft short SMS messages for UK garages. Max 160 characters. British English.
Include customer name, garage name, and key information. No sign-off.`;

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
): Promise<string> {
  const { garageName, garagePhone, customerFirstName, registration, vehicleDescription, reminderType, dueDate } = input;
  const label = reminderType === "mot" ? "MOT" : "service";
  const contactLine = garagePhone
    ? `Give us a call on ${garagePhone} or reply to this email to book in.`
    : `Reply to this email or get in touch to book in.`;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    system: [{ type: "text", text: EMAIL_REMINDER_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{
      role: "user",
      content: `Draft a ${label} reminder for:\n\nGarage: ${garageName}\nCustomer first name: ${customerFirstName}\nVehicle: ${vehicleDescription} (${registration})\n${label} due: ${dueDate}\nContact instruction: ${contactLine}\n\nStart with "Hi ${customerFirstName},"`,
    }],
  });

  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type from Claude");
  return block.text.trim();
}

export async function draftSmsReminderMessage(
  input: DraftReminderInput,
): Promise<string> {
  const { garageName, garagePhone, customerFirstName, registration, reminderType, dueDate } = input;
  const label = reminderType === "mot" ? "MOT" : "service";

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 80,
    system: [{ type: "text", text: SMS_REMINDER_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{
      role: "user",
      content: `SMS ${label} reminder: customer ${customerFirstName}, vehicle ${registration}, due ${dueDate}, from ${garageName}${garagePhone ? `, tel ${garagePhone}` : ""}.`,
    }],
  });

  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type from Claude");
  return block.text.trim();
}

export async function draftCustomMessage(
  input: DraftCustomMessageInput,
): Promise<{ email: string; sms: string }> {
  const { garageName, garagePhone, customerFirstName, topic } = input;
  const contactLine = garagePhone
    ? `Call us on ${garagePhone} or reply to this email.`
    : `Reply to this email to get in touch.`;

  const [emailRes, smsRes] = await Promise.all([
    anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: [{ type: "text", text: EMAIL_CUSTOM_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{
        role: "user",
        content: `Email from ${garageName} to customer ${customerFirstName}. Topic: ${topic}. Contact: ${contactLine}`,
      }],
    }),
    anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 80,
      system: [{ type: "text", text: SMS_CUSTOM_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{
        role: "user",
        content: `SMS from ${garageName} to ${customerFirstName}. Topic: ${topic}.${garagePhone ? ` Tel: ${garagePhone}.` : ""}`,
      }],
    }),
  ]);

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
};

export async function draftBroadcastMessage(
  input: DraftBroadcastInput,
): Promise<{ email: string; sms: string }> {
  const { garageName, garagePhone, topic } = input;
  const contactLine = garagePhone
    ? `Call us on ${garagePhone} or reply to this email.`
    : `Reply to this email to get in touch.`;

  const [emailRes, smsRes] = await Promise.all([
    anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: [{
        type: "text",
        text: `You draft short broadcast marketing emails for UK garages to send to all their customers. British English. Under 120 words. Start with "Dear customer," — warm but professional. End with a clear call to action. No subject line, no sign-off placeholder. Do not use a specific customer name.`,
        cache_control: { type: "ephemeral" },
      }],
      messages: [{
        role: "user",
        content: `Broadcast email from ${garageName}. Topic: ${topic}. Contact: ${contactLine}`,
      }],
    }),
    anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 80,
      system: [{
        type: "text",
        text: `Draft a broadcast SMS for a UK garage to send to all customers. Max 160 characters. British English. Include garage name and key info. No customer name, no sign-off.`,
        cache_control: { type: "ephemeral" },
      }],
      messages: [{
        role: "user",
        content: `Broadcast SMS from ${garageName}. Topic: ${topic}.${garagePhone ? ` Tel: ${garagePhone}.` : ""}`,
      }],
    }),
  ]);

  const emailBlock = emailRes.content[0];
  const smsBlock = smsRes.content[0];

  return {
    email: emailBlock.type === "text" ? emailBlock.text.trim() : `Dear customer,\n\n${topic}\n\nRegards, ${garageName}`,
    sms: smsBlock.type === "text" ? smsBlock.text.trim() : `${topic}. Contact ${garageName}.${garagePhone ? ` Tel: ${garagePhone}` : ""}`,
  };
}

export function fallbackReminderMessage(input: DraftReminderInput): string {
  const { customerFirstName, vehicleDescription, registration, reminderType, dueDate, garageName, garagePhone } = input;
  const label = reminderType === "mot" ? "MOT" : "service";
  const contact = garagePhone ? `Call us on ${garagePhone}` : "Get in touch";
  return `Hi ${customerFirstName},\n\nThis is a friendly reminder that your ${vehicleDescription} (${registration}) is due for its ${label} on ${dueDate}.\n\n${contact} to book your appointment with ${garageName}.\n\nThank you for your custom.`;
}

export function fallbackSmsReminderMessage(input: DraftReminderInput): string {
  const { customerFirstName, registration, reminderType, dueDate, garageName } = input;
  const label = reminderType === "mot" ? "MOT" : "service";
  return `Hi ${customerFirstName}, your ${registration} ${label} is due ${dueDate}. Please contact ${garageName} to book. Thank you.`;
}
