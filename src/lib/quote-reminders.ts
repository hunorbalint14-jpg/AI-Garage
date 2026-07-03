import { sendEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import { sendWhatsApp } from "@/lib/whatsapp";
import { garageLabel, garageLocationBlock, garageLocationInline } from "@/lib/garage-identity";
import { encrypt } from "@/lib/encryption";

// Phase 6 (quote reminders, #246). Shared between the staff server action
// (manual reminder) and the quote-expiry cron (automated schedule).

export type ReminderChannel = "email" | "sms" | "whatsapp";

// Encrypt the raw link token for at-rest storage so reminders can rebuild the
// customer URL later. MUST be non-fatal: quote sending predates this feature
// and must never break because APP_ENCRYPTION_KEY is absent in an environment
// — we store null and that quote simply can't be reminded.
export function encryptLinkToken(token: string): string | null {
  try {
    return encrypt(token);
  } catch (e) {
    console.error("[quote-reminders] link token not stored:", (e as Error).message);
    return null;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Which scheduled reminder day (if any) is due right now. Watermarked on
// last_reminder_at rather than a per-day ledger: a day fires only if it has
// arrived AND its calendar moment lies after the last reminder of any kind —
// so a manual nudge naturally absorbs auto days it already covers, and a
// missed cron window catches up with a single (latest) reminder, not a burst.
export function dueReminderDay(args: {
  sentAt: string;
  lastReminderAt: string | null;
  reminderCount: number;
  reminderDays: number[];
  reminderMax: number;
  expiresAt: string | null;
  now?: Date;
}): number | null {
  const now = args.now ?? new Date();
  if (!args.expiresAt || now.getTime() >= new Date(args.expiresAt).getTime()) return null;
  if (args.reminderCount >= args.reminderMax) return null;

  const sent = new Date(args.sentAt).getTime();
  if (!Number.isFinite(sent)) return null;
  const daysSinceSend = Math.floor((now.getTime() - sent) / DAY_MS);
  if (daysSinceSend < 1) return null;

  const last = args.lastReminderAt ? new Date(args.lastReminderAt).getTime() : null;
  const due = [...new Set(args.reminderDays)]
    .filter((d) => Number.isInteger(d) && d > 0)
    .sort((a, b) => a - b)
    .filter((d) => d <= daysSinceSend)
    .filter((d) => last === null || sent + d * DAY_MS > last)
    .pop();
  return due ?? null;
}

// Settings guardrails, shared by the save action and the cron (which clamps
// whatever is in the DB rather than trusting it blindly).
export const REMINDER_DAYS_MAX_ENTRIES = 10;
export const REMINDER_MAX_LIMIT = 10;

export function normaliseReminderDays(days: unknown): number[] {
  if (!Array.isArray(days)) return [];
  return [...new Set(days.map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 365))]
    .sort((a, b) => a - b)
    .slice(0, REMINDER_DAYS_MAX_ENTRIES);
}

export async function dispatchQuoteReminder(args: {
  customer: { full_name: string | null; email: string | null; phone: string | null };
  vehicleReg: string | null;
  title: string | null;
  total: number;
  garageName: string;
  locationName: string | null;
  address: string | null;
  phone?: string | null;
  expiresAt: string | null;
  url: string;
  channels: ReminderChannel[];
}): Promise<{ channels: string[] }> {
  const { customer, vehicleReg, title, total, expiresAt, url } = args;
  const wanted = new Set<ReminderChannel>(args.channels);
  const firstName = customer.full_name?.split(" ")[0] ?? "there";
  const totalFmt = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(total);
  const refSuffix = vehicleReg ? ` for ${vehicleReg}` : "";
  const identity = { orgName: args.garageName, locationName: args.locationName, address: args.address };
  const where = garageLabel(identity);
  const validUntil = expiresAt
    ? new Date(expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : null;

  const channels: string[] = [];

  if (wanted.has("email") && customer.email) {
    const result = await sendEmail({
      to: customer.email,
      subject: `Reminder: your quote from ${where}${validUntil ? ` — expires ${validUntil}` : ""}`,
      text: `Hi ${firstName},\n\nJust a friendly reminder that your quote${refSuffix} from ${where} is still waiting for your response.\n\n${title ? title + "\n" : ""}Total: ${totalFmt} (inc. VAT)${validUntil ? `\nValid until: ${validUntil}` : ""}\n\n${garageLocationBlock(identity)}`,
      cta: { url, label: "View and respond to your quote" },
    });
    if (result.success) channels.push("email");
  }

  const shortBody = `Reminder from ${garageLocationInline(identity)}: your quote${refSuffix} (${totalFmt}) awaits your response.${validUntil ? ` Valid until ${validUntil}.` : ""} ${url}`;

  if (wanted.has("sms") && customer.phone) {
    const result = await sendSms({ to: customer.phone, body: shortBody });
    if (result.success) channels.push("sms");
  }

  if (wanted.has("whatsapp") && customer.phone) {
    const result = await sendWhatsApp({ to: customer.phone, body: shortBody });
    if (result.success) channels.push("whatsapp");
  }

  return { channels };
}
