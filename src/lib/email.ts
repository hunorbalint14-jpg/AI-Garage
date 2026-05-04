import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = process.env.RESEND_FROM_EMAIL ?? "Garage-AI <onboarding@resend.dev>";

function textToHtml(text: string): string {
  const paragraphs = text
    .split("\n\n")
    .map((p) => `<p style="margin:0 0 16px 0">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111827;max-width:600px;margin:0 auto;padding:32px 24px">${paragraphs}<hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0"><p style="font-size:12px;color:#9ca3af;margin:0">Sent via Garage AI</p></body></html>`;
}

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
      html: textToHtml(text),
    });

    if (error) return { success: false, error: error.message };
    return { success: true, messageId: data?.id ?? "unknown" };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown email error",
    };
  }
}
