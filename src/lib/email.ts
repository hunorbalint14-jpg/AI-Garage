import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const SENDER_NAME = process.env.RESEND_SENDER_NAME ?? "AI Garage";
const RAW_FROM = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";
// Ensure the sender display name is always set. If the env value is a bare
// email address, wrap it; otherwise trust the caller's "Name <addr>" format.
const FROM = RAW_FROM.includes("<") ? RAW_FROM : `${SENDER_NAME} <${RAW_FROM}>`;

const PUBLIC_ORIGIN =
  process.env.NEXT_PUBLIC_ROOT_DOMAIN && !process.env.NEXT_PUBLIC_ROOT_DOMAIN.includes("localtest")
    ? `https://${process.env.NEXT_PUBLIC_ROOT_DOMAIN}`
    : "https://ai-garage.co.uk";
const ROOT_HOST = PUBLIC_ORIGIN.replace(/^https?:\/\//, "");
const LOGO_URL = `${PUBLIC_ORIGIN}/brand/icon/png/sms-avatar-brand-512.png`;

export type EmailCta = { url: string; label: string };

// Build a tenant-aware booking URL: https://{slug}.ai-garage.co.uk/book
export function tenantBookingUrl(slug: string, path = "/book"): string {
  return `https://${slug}.${ROOT_HOST}${path}`;
}

// The customer portal (authenticated) where they reschedule/cancel a booking.
// Must use the ORG slug — the portal resolves the tenant from organizations.slug.
export function tenantPortalUrl(orgSlug: string, path = "/dashboard"): string {
  return `https://${orgSlug}.${ROOT_HOST}${path}`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function ctaButtonHtml(cta: EmailCta): string {
  const url = escapeAttr(cta.url);
  const label = escapeText(cta.label);
  return `<div style="text-align:left;margin:28px 0"><a href="${url}" style="display:inline-block;background:#22c55e;color:#ffffff;font-weight:600;font-size:15px;text-decoration:none;padding:12px 24px;border-radius:8px;border:0">${label} →</a></div>`;
}

function textToHtml(text: string, cta?: EmailCta): string {
  const paragraphs = text
    .split("\n\n")
    .map((p) => `<p style="margin:0 0 16px 0">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  const ctaHtml = cta ? ctaButtonHtml(cta) : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111827;max-width:600px;margin:0 auto;padding:32px 24px"><div style="text-align:left;margin-bottom:24px"><img src="${LOGO_URL}" width="56" height="56" alt="AI Garage" style="display:block;border-radius:12px;border:0;outline:0;text-decoration:none"></div>${paragraphs}${ctaHtml}<hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0"><p style="font-size:12px;color:#9ca3af;margin:0">Sent via AI Garage · <a href="${PUBLIC_ORIGIN}" style="color:#9ca3af;text-decoration:underline">ai-garage.co.uk</a></p></body></html>`;
}

function appendCtaToText(text: string, cta?: EmailCta): string {
  if (!cta) return text;
  return `${text}\n\n${cta.label}: ${cta.url}`;
}

export type SendEmailResult =
  | { success: true; messageId: string }
  | { success: false; error: string };

export type BatchEmailItem = {
  to: string;
  subject: string;
  text: string;
  cta?: EmailCta;
};

export type BatchEmailItemResult = {
  success: boolean;
  error: string | null;
  // Null when the chunk had partial failures: Resend's permissive batch
  // response doesn't say which created id belongs to which input then.
  messageId: string | null;
};

const RESEND_BATCH_LIMIT = 100;

// Send many emails via Resend's batch endpoint (100 per call) instead of one
// request per recipient. Results align 1:1 with `items`. Never throws.
export async function sendEmailBatch(items: BatchEmailItem[]): Promise<BatchEmailItemResult[]> {
  const results: BatchEmailItemResult[] = items.map(() => ({
    success: false,
    error: "Not sent",
    messageId: null,
  }));

  for (let start = 0; start < items.length; start += RESEND_BATCH_LIMIT) {
    const batch = items.slice(start, start + RESEND_BATCH_LIMIT);
    try {
      const { data, error } = await resend.batch.send(
        batch.map((i) => ({
          from: FROM,
          to: [i.to],
          subject: i.subject,
          text: appendCtaToText(i.text, i.cta),
          html: textToHtml(i.text, i.cta),
        })),
        { batchValidation: "permissive" },
      );

      if (error) {
        for (let j = 0; j < batch.length; j++) {
          results[start + j] = { success: false, error: error.message, messageId: null };
        }
        continue;
      }

      const failedByIndex = new Map<number, string>();
      for (const e of data?.errors ?? []) failedByIndex.set(e.index, e.message);
      const idsAligned = failedByIndex.size === 0 && (data?.data?.length ?? 0) === batch.length;

      for (let j = 0; j < batch.length; j++) {
        const failure = failedByIndex.get(j);
        results[start + j] = failure
          ? { success: false, error: failure, messageId: null }
          : { success: true, error: null, messageId: idsAligned ? data!.data[j].id : null };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown email error";
      for (let j = 0; j < batch.length; j++) {
        results[start + j] = { success: false, error: msg, messageId: null };
      }
    }
  }

  return results;
}

export async function sendEmail({
  to,
  subject,
  text,
  html,
  cta,
}: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  cta?: EmailCta;
}): Promise<SendEmailResult> {
  try {
    const { data, error } = await resend.emails.send({
      from: FROM,
      to: [to],
      subject,
      text: appendCtaToText(text, cta),
      html: html ?? textToHtml(text, cta),
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
