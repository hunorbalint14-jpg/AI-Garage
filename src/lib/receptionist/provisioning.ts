import "server-only";
import twilio from "twilio";
import { publicOrigin } from "@/lib/stripe";

// Twilio number provisioning for the AI receptionist. Operator-only (called
// from platform-admin server actions). Searches available numbers, buys one
// with the receptionist webhooks pre-wired, and releases by SID. Every inbound
// number for every tenant points at the same two webhook URLs — the app routes
// by the `To` number — so we set those URLs at purchase time and never touch
// them again.

export type AvailableNumber = {
  phoneNumber: string;
  friendlyName: string;
  locality: string | null;
  region: string | null;
};

export type NumberType = "mobile" | "local";

function client() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new Error("Twilio is not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN).");
  }
  return twilio(accountSid, authToken);
}

// The two webhooks Twilio posts to. Built from the canonical public origin so
// the URL Twilio signs matches what the webhook routes verify against.
export function receptionistWebhookUrls(): { voiceUrl: string; smsUrl: string } {
  const origin = publicOrigin();
  return {
    voiceUrl: `${origin}/api/webhooks/twilio/voice`,
    smsUrl: `${origin}/api/webhooks/twilio/messages`,
  };
}

export async function searchAvailableNumbers(args: {
  country?: string;
  type?: NumberType;
  areaCode?: string;
  contains?: string;
  limit?: number;
}): Promise<AvailableNumber[]> {
  const country = (args.country ?? "GB").toUpperCase();
  const type: NumberType = args.type ?? "mobile";
  const opts: {
    smsEnabled: boolean;
    voiceEnabled: boolean;
    limit: number;
    areaCode?: number;
    contains?: string;
  } = {
    smsEnabled: true,
    voiceEnabled: true,
    limit: Math.min(args.limit ?? 10, 30),
  };
  if (args.areaCode) opts.areaCode = Number(args.areaCode);
  if (args.contains) opts.contains = args.contains;

  const list =
    type === "mobile"
      ? await client().availablePhoneNumbers(country).mobile.list(opts)
      : await client().availablePhoneNumbers(country).local.list(opts);

  return list.map((n) => ({
    phoneNumber: n.phoneNumber,
    friendlyName: n.friendlyName,
    locality: n.locality || null,
    region: n.region || null,
  }));
}

export type PurchasedNumber = { sid: string; phoneNumber: string };

// Buy a number with the receptionist webhooks already attached. Voice + SMS
// both POST; that's what the webhook routes expect.
export async function purchaseNumber(args: {
  phoneNumber: string;
  friendlyName: string;
}): Promise<PurchasedNumber> {
  const { voiceUrl, smsUrl } = receptionistWebhookUrls();
  const bought = await client().incomingPhoneNumbers.create({
    phoneNumber: args.phoneNumber,
    friendlyName: args.friendlyName,
    voiceUrl,
    voiceMethod: "POST",
    smsUrl,
    smsMethod: "POST",
  });
  return { sid: bought.sid, phoneNumber: bought.phoneNumber };
}

// Release a number back to Twilio (stops billing for it). Idempotent-ish: a
// 404 (already released) is swallowed so the caller can still clear the row.
export async function releaseNumber(sid: string): Promise<void> {
  try {
    await client().incomingPhoneNumbers(sid).remove();
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) return;
    throw err;
  }
}
