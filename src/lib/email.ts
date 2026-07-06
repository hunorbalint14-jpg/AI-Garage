import { Resend } from "resend";
import {
  renderEmail,
  paragraphsToHtml,
  type EmailCta,
  type EmailDetailRow,
  type RenderEmailOpts,
} from "./email-layout";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadSuppressed } from "./email-suppression";

const resend = new Resend(process.env.RESEND_API_KEY);

// Lazily-created service-role client used only to consult the email
// suppression list (populated by the Resend webhook). Lazy so importing this
// module never requires the service-role env at import time.
let _admin: ReturnType<typeof createAdminClient> | null = null;
const suppressionClient = () => (_admin ??= createAdminClient());

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

export type { EmailCta, EmailDetailRow };
export { paragraphsToHtml };

// Render a tenant-branded email into the shared shell with the platform's
// public origin filled in. Bespoke templates (booking confirmation, receipts)
// build their email body with this instead of hand-rolling a document.
export function renderBrandedEmail(opts: Omit<RenderEmailOpts, "publicOrigin">): string {
  return renderEmail({ ...opts, publicOrigin: PUBLIC_ORIGIN });
}

// Render a PLATFORM (AI Garage) branded email into the shared shell — the
// platform's own name + logo prefilled. For emails we send *as* AI Garage
// (owner onboarding, platform billing) rather than on a tenant's behalf.
export function renderPlatformEmail(
  opts: Omit<RenderEmailOpts, "publicOrigin" | "brandName" | "logoUrl">,
): string {
  return renderEmail({ brandName: SENDER_NAME, logoUrl: LOGO_URL, ...opts, publicOrigin: PUBLIC_ORIGIN });
}

// Build a tenant-aware booking URL: https://{slug}.ai-garage.co.uk/book
export function tenantBookingUrl(slug: string, path = "/book"): string {
  return `https://${slug}.${ROOT_HOST}${path}`;
}

// The customer portal (authenticated) where they reschedule/cancel a booking.
// Must use the ORG slug — the portal resolves the tenant from organizations.slug.
export function tenantPortalUrl(orgSlug: string, path = "/dashboard"): string {
  return `https://${orgSlug}.${ROOT_HOST}${path}`;
}

// Generic transactional email body — renders the plain text into the shared
// dark/branded shell (see email-layout.ts). Tenant-specific emails that need a
// richer layout build their own renderEmail() call.
function textToHtml(text: string, cta?: EmailCta): string {
  return renderEmail({
    brandName: SENDER_NAME,
    logoUrl: LOGO_URL,
    bodyHtml: paragraphsToHtml(text),
    cta,
    publicOrigin: PUBLIC_ORIGIN,
  });
}

function appendCtaToText(text: string, cta?: EmailCta): string {
  if (!cta) return text;
  return `${text}\n\n${cta.label}: ${cta.url}`;
}

export type SendEmailResult =
  | { success: true; messageId: string }
  | { success: false; error: string; suppressed?: boolean };

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
  // True when the item was skipped because the recipient is on the
  // suppression list (hard bounce / complaint) rather than actually sent.
  suppressed?: boolean;
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

  // Skip suppressed recipients (hard bounce / complaint) — never send to them.
  const suppressed = await loadSuppressed(suppressionClient(), items.map((i) => i.to));

  for (let start = 0; start < items.length; start += RESEND_BATCH_LIMIT) {
    // The indices in this chunk we will actually send — suppressed ones are
    // marked in-place and left out of the Resend call, so the response index
    // maps back through `sendIdx`.
    const sendIdx: number[] = [];
    for (let i = start; i < Math.min(start + RESEND_BATCH_LIMIT, items.length); i++) {
      if (suppressed.has(items[i].to.trim().toLowerCase())) {
        results[i] = { success: false, error: "Recipient suppressed (bounce/complaint).", messageId: null, suppressed: true };
      } else {
        sendIdx.push(i);
      }
    }
    if (sendIdx.length === 0) continue;

    const batch = sendIdx.map((i) => items[i]);
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
        for (const i of sendIdx) results[i] = { success: false, error: error.message, messageId: null };
        continue;
      }

      const failedByIndex = new Map<number, string>();
      for (const e of data?.errors ?? []) failedByIndex.set(e.index, e.message);
      const idsAligned = failedByIndex.size === 0 && (data?.data?.length ?? 0) === batch.length;

      for (let j = 0; j < batch.length; j++) {
        const failure = failedByIndex.get(j);
        results[sendIdx[j]] = failure
          ? { success: false, error: failure, messageId: null }
          : { success: true, error: null, messageId: idsAligned ? data!.data[j].id : null };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown email error";
      for (const i of sendIdx) results[i] = { success: false, error: msg, messageId: null };
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
    const suppressed = await loadSuppressed(suppressionClient(), [to]);
    if (suppressed.has(to.trim().toLowerCase())) {
      return { success: false, suppressed: true, error: "Recipient suppressed (previous hard bounce or spam complaint)." };
    }

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
