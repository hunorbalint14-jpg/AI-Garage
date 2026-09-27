import type { Evidence, ServiceType } from "@/lib/tyre-care";

// Customer-message helpers for tyre-care sends (#596 PR 5). Pure, so the
// wording and the contact limits are unit-tested.
//
// The standard wording is a plain template, not AI: it opens the composer
// pre-filled so every message states WHY by default (the spec's trust
// guardrail), and staff edit it freely. AI stays opt-in through the assist
// menu, per the compose-first rule.

const DAY_MS = 24 * 60 * 60 * 1000;

/** No customer hears from the garage's automated nudges more than once in this window. */
export const CONTACT_CAP_DAYS = 30;
/** Hard ceiling on tyre-care messages to one customer in a rolling year. */
export const ANNUAL_TYRE_CARE_CAP = 6;

export const SERVICE_LABEL: Record<ServiceType, string> = {
  rotation: "tyre rotation",
  alignment: "wheel alignment check",
  balance: "wheel balance",
};

/** The benefit, stated concretely (spec: tyre life, economy, safety). */
const BENEFIT: Record<ServiceType, string> = {
  rotation:
    "Rotating your tyres evens out the wear between the front and back, so the set lasts longer and the car handles consistently.",
  alignment:
    "Getting the alignment checked stops uneven wear eating into your tyres early, and helps with fuel economy and straight-line handling.",
  balance: "Balancing your wheels stops vibration at speed and uneven tyre wear.",
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** A clause short enough for a text message, built from the structured evidence. */
export function shortReason(evidence: Evidence): string {
  const inputs = evidence.inputs ?? {};
  switch (evidence.rule_key) {
    case "rotation.interval": {
      const miles = num(inputs.miles_since_baseline);
      const since = inputs.baseline_kind === "fitment" ? "your new tyres went on" : "they were last rotated";
      return miles !== null
        ? `it's about ${Math.round(miles).toLocaleString("en-GB")} miles since ${since}`
        : `it's been a while since ${since}`;
    }
    case "rotation.tread_differential":
      return inputs.front_worn_more === false
        ? "your rear tyres are wearing faster than the fronts"
        : "your front tyres are wearing faster than the rears";
    case "alignment.axle_differential":
      return "your tyres are wearing unevenly";
    case "alignment.mot_advisory":
      return "your last MOT noted uneven tyre wear";
    case "alignment.after_steering_work":
      return "after the recent steering work, it's worth checking";
    case "alignment.new_tyres_unaligned":
      return "your new tyres went on without an alignment check";
    default:
      return evidence.reason;
  }
}

export type DraftInput = {
  firstName: string;
  registration: string;
  vehicleName: string | null;
  serviceType: ServiceType;
  evidence: Evidence;
  garageLabel: string;
};

export type StandardDraft = { subject: string; email: string; sms: string };

export function standardDraft(input: DraftInput): StandardDraft {
  const service = SERVICE_LABEL[input.serviceType];
  const car = input.vehicleName ? `${input.vehicleName} (${input.registration})` : input.registration;
  const serviceTitle = service.charAt(0).toUpperCase() + service.slice(1);
  return {
    subject: `${serviceTitle} recommended for ${input.registration} — ${input.garageLabel}`,
    email: [
      `Hi ${input.firstName},`,
      `We'd recommend a ${service} for your ${car}. ${input.evidence.reason}`,
      BENEFIT[input.serviceType],
      "You can book it in with the button below — it only takes a minute.",
    ].join("\n\n"),
    sms: `Hi ${input.firstName}, we'd recommend a ${service} for ${input.registration} — ${shortReason(input.evidence)}. Book online:`,
  };
}

// UK garages name these services many ways ("tracking", "4-wheel alignment",
// "tyre rotation"). Best-effort match against the branch's own catalogue; no
// match just means the booking link pre-fills the vehicle, not the service.
const SERVICE_PATTERNS: Record<ServiceType, RegExp> = {
  rotation: /\brotat/i,
  alignment: /\b(align|tracking|geometry)/i,
  balance: /\bbalanc/i,
};

export function matchTyreService(
  services: { id: string; name: string }[],
  serviceType: ServiceType,
): string | null {
  const pattern = SERVICE_PATTERNS[serviceType];
  return services.find((s) => pattern.test(s.name))?.id ?? null;
}

export type ContactCap =
  | { allowed: true }
  | { allowed: false; reason: string; availableFrom: string | null };

/**
 * The frequency guardrail: at most one automated nudge per customer per 30
 * days across every sender, and a yearly ceiling on tyre-care messages.
 */
export function contactCapStatus(args: {
  lastContactedAt: string | null;
  lastContactKind: string | null;
  tyreCareSendsLastYear: number;
  now?: Date;
}): ContactCap {
  const now = args.now ?? new Date();
  if (args.tyreCareSendsLastYear >= ANNUAL_TYRE_CARE_CAP) {
    return {
      allowed: false,
      reason: `This customer has had ${ANNUAL_TYRE_CARE_CAP} tyre-care messages in the last year — the yearly limit.`,
      availableFrom: null,
    };
  }
  if (args.lastContactedAt) {
    const last = Date.parse(args.lastContactedAt);
    if (Number.isFinite(last) && now.getTime() - last < CONTACT_CAP_DAYS * DAY_MS) {
      const from = new Date(last + CONTACT_CAP_DAYS * DAY_MS);
      const days = Math.max(1, Math.floor((now.getTime() - last) / DAY_MS));
      return {
        allowed: false,
        reason: `Contacted ${days} day${days === 1 ? "" : "s"} ago${args.lastContactKind ? ` (${args.lastContactKind})` : ""} — one message per 30 days.`,
        availableFrom: from.toISOString().slice(0, 10),
      };
    }
  }
  return { allowed: true };
}
