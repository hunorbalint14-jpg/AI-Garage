import crypto from "node:crypto";
import type { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

// Marketing opt-out links (#596 PR 5, platform infra). One token per message;
// only the sha256 is stored, and rows are never overwritten, so every link in
// every old message keeps working. Consent lives on `customers` per channel —
// the same two booleans the booking form and the customer portal already set.

type Admin = ReturnType<typeof createAdminClient>;

export type UnsubscribeSource = "tyre_care";

/**
 * 16 random bytes (128 bits) — unguessable, and short enough that an SMS
 * carrying both a booking link and an opt-out link stays readable.
 */
export function generateUnsubscribeToken(): string {
  return crypto.randomBytes(16).toString("base64url");
}

export function hashUnsubscribeToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/** Mint and store a token for one outgoing message. Throws if it can't be stored. */
export async function mintUnsubscribeToken(
  admin: Admin,
  args: { customerId: string; organizationId: string; source: UnsubscribeSource },
): Promise<string> {
  const token = generateUnsubscribeToken();
  const { error } = await admin.from("unsubscribe_tokens").insert({
    token_hash: hashUnsubscribeToken(token),
    customer_id: args.customerId,
    organization_id: args.organizationId,
    source: args.source,
  });
  if (error) throw new Error(`unsubscribe token: ${error.message}`);
  return token;
}

export type UnsubscribeContext = {
  customerId: string;
  organizationId: string;
  orgName: string;
  emailConsent: boolean;
  smsConsent: boolean;
  hasEmail: boolean;
  hasPhone: boolean;
};

export async function resolveUnsubscribeToken(admin: Admin, rawToken: string | null): Promise<UnsubscribeContext | null> {
  if (!rawToken || rawToken.length < 16) return null;
  const { data } = await admin
    .from("unsubscribe_tokens")
    .select(
      "customer_id, organization_id, customer:customers(id, email, phone, marketing_email_consent, marketing_sms_consent, anonymized_at), organization:organizations(name)",
    )
    .eq("token_hash", hashUnsubscribeToken(rawToken))
    .maybeSingle();
  const row = data as unknown as {
    customer_id: string;
    organization_id: string;
    customer: {
      id: string;
      email: string | null;
      phone: string | null;
      marketing_email_consent: boolean;
      marketing_sms_consent: boolean;
      anonymized_at: string | null;
    } | null;
    organization: { name: string } | null;
  } | null;
  if (!row?.customer || row.customer.anonymized_at) return null;
  return {
    customerId: row.customer_id,
    organizationId: row.organization_id,
    orgName: row.organization?.name ?? "the garage",
    emailConsent: row.customer.marketing_email_consent,
    smsConsent: row.customer.marketing_sms_consent,
    hasEmail: Boolean(row.customer.email),
    hasPhone: Boolean(row.customer.phone),
  };
}

/**
 * Withdraw marketing consent on the chosen channels. Idempotent. Returns
 * false for an unknown token — callers must not reveal the difference.
 */
export async function applyUnsubscribe(
  admin: Admin,
  rawToken: string,
  channels: { email: boolean; sms: boolean },
  via: "unsubscribe_page" | "one_click",
): Promise<boolean> {
  const ctx = await resolveUnsubscribeToken(admin, rawToken);
  if (!ctx) return false;
  if (!channels.email && !channels.sms) return true;

  const patch: Record<string, unknown> = { consent_updated_at: new Date().toISOString() };
  if (channels.email) patch.marketing_email_consent = false;
  if (channels.sms) patch.marketing_sms_consent = false;

  const { error } = await admin.from("customers").update(patch).eq("id", ctx.customerId);
  if (error) throw new Error(`unsubscribe: ${error.message}`);

  await admin
    .from("unsubscribe_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("token_hash", hashUnsubscribeToken(rawToken));

  await logAudit({
    organizationId: ctx.organizationId,
    actorUserId: null,
    actorEmail: null,
    action: "customer.consent_update",
    entityType: "customer",
    entityId: ctx.customerId,
    metadata: {
      via,
      email_consent: channels.email ? false : ctx.emailConsent,
      sms_consent: channels.sms ? false : ctx.smsConsent,
    },
  });
  return true;
}
