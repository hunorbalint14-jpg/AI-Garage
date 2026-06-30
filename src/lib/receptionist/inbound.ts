import twilio from "twilio";
import { createAdminClient } from "@/lib/supabase/admin";
import { tenantBillingActive, tenantHasFeature, type OrgBilling } from "@/lib/tenant-plans";
import { normalizeBusinessDays } from "@/lib/business-days";
import type { TranscriptMessage } from "./agent";

// Shared plumbing for the Twilio receptionist webhooks: signature
// validation, To-number → location routing, entitlement gating, and
// conversation load/append.

export const CONVERSATION_IDLE_HOURS = 24;
// Cap what we replay to the model — old turns stop mattering and tokens cost.
export const TRANSCRIPT_MODEL_WINDOW = 20;

export function validateTwilioSignature(args: {
  signature: string | null;
  url: string;
  params: Record<string, string>;
}): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken || !args.signature) return false;
  return twilio.validateRequest(authToken, args.signature, args.url, args.params);
}

/** "whatsapp:+447..." → { number: "+447...", channel: "whatsapp" } */
export function parseTwilioAddress(raw: string): { number: string; channel: "sms" | "whatsapp" } {
  if (raw.startsWith("whatsapp:")) return { number: raw.slice("whatsapp:".length), channel: "whatsapp" };
  return { number: raw, channel: "sms" };
}

export type RoutedLocation = {
  locationId: string;
  organizationId: string;
  garageName: string;
  locationName: string;
  businessHoursStart: number;
  businessHoursEnd: number;
  businessDays: number[];
  forwardToPhone: string | null;
  forwardTimeoutSeconds: number;
  twilioNumber: string;
};

// Resolve the inbound To number to an enabled, entitled location. Returns
// null when the number is unknown, the feature is off, or the org's tier
// doesn't include the receptionist (lapsed billing included).
export async function routeInboundNumber(toNumber: string): Promise<RoutedLocation | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("receptionist_configs")
    .select(
      "location_id, enabled, twilio_number, forward_to_phone, forward_timeout_seconds, location:locations(id, name, business_hours_start, business_hours_end, business_days, organization:organizations(id, name, tenant_plan, tenant_subscription_status, tenant_current_period_end, tenant_trial_end))",
    )
    .eq("twilio_number", toNumber)
    .maybeSingle();

  type Row = {
    location_id: string;
    enabled: boolean;
    twilio_number: string;
    forward_to_phone: string | null;
    forward_timeout_seconds: number;
    location: {
      id: string;
      name: string;
      business_hours_start: number | null;
      business_hours_end: number | null;
      business_days: number[] | null;
      organization: ({ id: string; name: string } & OrgBilling) | null;
    } | null;
  };
  const row = data as Row | null;
  if (!row || !row.enabled || !row.location?.organization) return null;

  const org = row.location.organization;
  if (!tenantHasFeature(org, "receptionist") || !tenantBillingActive(org)) return null;

  return {
    locationId: row.location_id,
    organizationId: org.id,
    garageName: org.name,
    locationName: row.location.name,
    businessHoursStart: row.location.business_hours_start ?? 8,
    businessHoursEnd: row.location.business_hours_end ?? 18,
    businessDays: normalizeBusinessDays(row.location.business_days),
    forwardToPhone: row.forward_to_phone,
    forwardTimeoutSeconds: row.forward_timeout_seconds ?? 20,
    twilioNumber: row.twilio_number,
  };
}

export type ConversationRow = {
  id: string;
  status: string;
  messages: TranscriptMessage[];
};

// Active thread for this caller, or a fresh one. A thread that's been idle
// past the window is left as-is (expired lazily) and a new one starts.
export async function loadOrCreateConversation(args: {
  locationId: string;
  customerPhone: string;
  channel: "sms" | "whatsapp";
  source: "inbound_message" | "missed_call";
}): Promise<ConversationRow | null> {
  const admin = createAdminClient();
  const idleCutoff = new Date(Date.now() - CONVERSATION_IDLE_HOURS * 60 * 60 * 1000).toISOString();

  const { data: existing } = await admin
    .from("receptionist_conversations")
    .select("id, status, messages")
    .eq("location_id", args.locationId)
    .eq("customer_phone", args.customerPhone)
    .eq("status", "active")
    .gte("last_message_at", idleCutoff)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing as ConversationRow;

  const { data: created, error } = await admin
    .from("receptionist_conversations")
    .insert({
      location_id: args.locationId,
      customer_phone: args.customerPhone,
      channel: args.channel,
      source: args.source,
    })
    .select("id, status, messages")
    .single();
  if (error) {
    console.error("[receptionist] conversation create failed", error.message);
    return null;
  }
  return created as ConversationRow;
}

export async function appendMessages(
  conversationId: string,
  messages: TranscriptMessage[],
  additions: TranscriptMessage[],
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("receptionist_conversations")
    .update({
      messages: [...messages, ...additions],
      last_message_at: new Date().toISOString(),
    })
    .eq("id", conversationId);
}
