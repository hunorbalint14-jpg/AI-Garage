import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM =
  process.env.RESEND_FROM_EMAIL ?? "Garage-AI <onboarding@resend.dev>";

export type SendEmailResult =
  | { success: true; messageId: string }
  | { success: false; error: string };

export async function sendEmail({
  to,
  subject,
  text,
}: {
  to: string;
  subject: string;
  text: string;
}): Promise<SendEmailResult> {
  try {
    const { data, error } = await resend.emails.send({
      from: FROM,
      to: [to],
      subject,
      text,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id ?? "unknown" };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown email error",
    };
  }
}
