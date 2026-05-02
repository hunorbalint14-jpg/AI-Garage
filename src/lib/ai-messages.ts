import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const SYSTEM_PROMPT = `You draft short, friendly vehicle reminder emails for UK garages.
Write in British English. Keep messages under 120 words — warm but professional.
Include all key vehicle and date details. End with a clear call to action (call to book in or reply to this email).
Return only the email body. Start with "Hi [first name]," — no subject line, no sign-off placeholder.`;

export type DraftReminderInput = {
  garageName: string;
  garagePhone: string | null;
  customerFirstName: string;
  registration: string;
  vehicleDescription: string; // e.g. "2018 Ford Focus"
  reminderType: "mot" | "service";
  dueDate: string; // formatted date string
};

export async function draftReminderMessage(
  input: DraftReminderInput,
): Promise<string> {
  const {
    garageName,
    garagePhone,
    customerFirstName,
    registration,
    vehicleDescription,
    reminderType,
    dueDate,
  } = input;

  const label = reminderType === "mot" ? "MOT" : "service";
  const contactLine = garagePhone
    ? `Give us a call on ${garagePhone} or reply to this email to book in.`
    : `Reply to this email or get in touch to book in.`;

  const userMessage = `Draft a ${label} reminder for:

Garage: ${garageName}
Customer first name: ${customerFirstName}
Vehicle: ${vehicleDescription} (${registration})
${label} due: ${dueDate}
Contact instruction: ${contactLine}

Start with "Hi ${customerFirstName},"`;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userMessage }],
  });

  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type from Claude");
  return block.text.trim();
}

export function fallbackReminderMessage(
  input: DraftReminderInput,
): string {
  const { customerFirstName, vehicleDescription, registration, reminderType, dueDate, garageName, garagePhone } = input;
  const label = reminderType === "mot" ? "MOT" : "service";
  const contact = garagePhone ? `Call us on ${garagePhone}` : "Get in touch";
  return `Hi ${customerFirstName},\n\nThis is a friendly reminder that your ${vehicleDescription} (${registration}) is due for its ${label} on ${dueDate}.\n\n${contact} to book your appointment with ${garageName}.\n\nThank you for your custom.`;
}
