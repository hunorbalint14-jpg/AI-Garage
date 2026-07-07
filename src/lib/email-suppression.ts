import type { createAdminClient } from "@/lib/supabase/admin";

// Email suppression (#444). A hard bounce means the inbox is dead; a complaint
// means the recipient marked us as spam. Either way we must stop sending to
// that address — continuing tanks the shared Resend domain's deliverability.
// The Resend webhook writes this list; src/lib/email.ts checks it before every
// send. See migration 20260706130000_email_suppressions.sql.

type Admin = ReturnType<typeof createAdminClient>;

export type SuppressionReason = "hard_bounce" | "complaint";
export type SuppressionEntry = { email: string; reason: SuppressionReason; detail: string | null };

// Minimal shape of the Resend webhook events we act on.
export type ResendWebhookEvent = {
  type: string;
  data?: {
    email_id?: string;
    to?: string[] | string;
    bounce?: { type?: string; subType?: string; message?: string } | null;
  };
};

const norm = (e: string) => e.trim().toLowerCase();

function recipients(data: ResendWebhookEvent["data"]): string[] {
  const to = data?.to;
  const list = Array.isArray(to) ? to : to ? [to] : [];
  return [...new Set(list.map(norm).filter(Boolean))];
}

// Resend reports permanent (hard) vs transient (soft) bounces. Only permanent
// bounces suppress — a transient bounce (full mailbox, greylisting) may clear,
// so we keep sending. Unknown/absent type is treated as NOT permanent so we
// never wrongly kill a good address.
export function isHardBounce(bounceType?: string | null): boolean {
  return /permanent|hard/i.test(bounceType ?? "");
}

// Pure: given a Resend webhook event, return the addresses to suppress (one per
// recipient) — empty for events that don't warrant suppression (soft bounces,
// opens, deliveries, …).
export function parseSuppression(event: ResendWebhookEvent): SuppressionEntry[] {
  const emails = recipients(event.data);
  if (emails.length === 0) return [];

  if (event.type === "email.complained") {
    return emails.map((email) => ({ email, reason: "complaint", detail: null }));
  }

  if (event.type === "email.bounced") {
    const b = event.data?.bounce ?? undefined;
    if (!isHardBounce(b?.type)) return [];
    const detail = b?.subType || b?.message || b?.type || null;
    return emails.map((email) => ({ email, reason: "hard_bounce", detail }));
  }

  return [];
}

// Upsert suppression entries. Preserves first_seen_at (not in the payload) and
// bumps last_seen_at on repeat events.
export async function suppressEmails(
  admin: Admin,
  entries: SuppressionEntry[],
  resendEmailId: string | null,
): Promise<void> {
  if (entries.length === 0) return;
  const now = new Date().toISOString();
  await admin.from("email_suppressions").upsert(
    entries.map((e) => ({
      email: e.email,
      reason: e.reason,
      detail: e.detail,
      resend_email_id: resendEmailId,
      last_seen_at: now,
    })),
    { onConflict: "email" },
  );
}

// Return the subset of `emails` that are suppressed (lowercased). Empty input →
// empty set; a query error fails open (returns empty) so a transient DB blip
// never blocks a legitimate send.
export async function loadSuppressed(admin: Admin, emails: string[]): Promise<Set<string>> {
  const wanted = [...new Set(emails.map(norm).filter(Boolean))];
  if (wanted.length === 0) return new Set();
  const { data, error } = await admin
    .from("email_suppressions")
    .select("email")
    .in("email", wanted);
  if (error || !data) return new Set();
  return new Set(data.map((r) => norm(r.email as string)));
}
