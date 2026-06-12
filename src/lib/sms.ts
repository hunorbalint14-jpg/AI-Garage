import twilio from "twilio";

export type SendSmsResult =
  | { success: true; messageSid: string }
  | { success: false; error: string };

function toE164(phone: string): string {
  const digits = phone.replace(/\s+/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("07")) return "+44" + digits.slice(1);
  if (digits.startsWith("44")) return "+" + digits;
  return digits;
}

export async function sendSms({
  to,
  body,
  from: fromOverride,
}: {
  to: string;
  body: string;
  /** Override the platform number — e.g. a location's receptionist number. */
  from?: string;
}): Promise<SendSmsResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = fromOverride ?? process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !from) {
    return { success: false, error: "Twilio not configured." };
  }

  try {
    const client = twilio(accountSid, authToken);
    const message = await client.messages.create({
      body,
      from,
      to: toE164(to),
    });
    return { success: true, messageSid: message.sid };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown SMS error",
    };
  }
}
