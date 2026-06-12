import twilio from "twilio";

export type SendWhatsAppResult =
  | { success: true; messageSid: string }
  | { success: false; error: string };

function toE164(phone: string): string {
  const digits = phone.replace(/\s+/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("07")) return "+44" + digits.slice(1);
  if (digits.startsWith("44")) return "+" + digits;
  return digits;
}

export async function sendWhatsApp({
  to,
  body,
  from: fromOverride,
}: {
  to: string;
  body: string;
  /** Override, "whatsapp:+44..." — e.g. a location's receptionist number. */
  from?: string;
}): Promise<SendWhatsAppResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = fromOverride ?? process.env.TWILIO_WHATSAPP_FROM; // e.g. "whatsapp:+14155238886"

  if (!accountSid || !authToken || !from) {
    return { success: false, error: "WhatsApp not configured." };
  }

  try {
    const client = twilio(accountSid, authToken);
    const message = await client.messages.create({
      body,
      from,
      to: `whatsapp:${toE164(to)}`,
    });
    return { success: true, messageSid: message.sid };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown WhatsApp error",
    };
  }
}
