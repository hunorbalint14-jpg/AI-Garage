// Client-safe half of the AI profile module: types, survey option sets, and the
// pure prompt-injection helper. NO server-only imports (no anthropic, no admin,
// no next/server) — the onboarding client form imports from here, so pulling in
// ai-usage's `after` would break the client bundle. Server-only bits
// (generateAiBrief, getOrgAiBrief) live in ai-profile.ts, which re-exports this.

export type AiProfileAnswers = {
  specialisms: string[];
  marques: string; // free text, when "marque specialist" is ticked
  tone: string;
  services: string[];
  signatureServices: string;
  amenities: string[];
  leadTime: string;
  diagnostics: string[];
  doesNotDo: string;
  partsPolicy: string;
  tyres: string;
  bookingPreference: string;
  promotions: string;
  receptionistStyle: string;
  escalation: string;
  neverSay: string;
  extraNotes: string;
};

// Option sets shared by the onboarding form. Free-text fields are not listed.
export const SPECIALISM_OPTIONS = [
  "General servicing & repair",
  "MOT testing",
  "EV / hybrid",
  "Diagnostics specialist",
  "Performance / tuning",
  "Classic / vintage",
  "Bodywork / paint",
  "Tyres & wheels",
  "Air-conditioning",
  "Fleet / commercial",
  "Marque specialist",
];

export const TONE_OPTIONS = [
  "Friendly & casual",
  "Professional & formal",
  "Concise & no-nonsense",
  "Warm & reassuring",
];

export const SERVICE_OPTIONS = [
  "MOT",
  "Full / interim service",
  "Brakes",
  "Clutch & transmission",
  "Engine / timing",
  "Diagnostics",
  "Air-con regas",
  "Tyres",
  "Exhaust",
  "Suspension & steering",
  "Battery & electrics",
  "Cambelt / timing belt",
];

export const AMENITY_OPTIONS = [
  "Courtesy car",
  "Collection & delivery",
  "While-you-wait appointments",
  "Local drop-off lift",
  "Wi-Fi waiting area",
];

export const DIAGNOSTIC_OPTIONS = [
  "Dealer-level diagnostics",
  "ADAS calibration",
  "Key programming",
  "DPF cleaning",
  "EV high-voltage",
  "Air-con diagnostics",
];

export const BOOKING_PREFERENCE_OPTIONS = ["Online booking", "Phone", "Either"];

export function emptyAnswers(): AiProfileAnswers {
  return {
    specialisms: [],
    marques: "",
    tone: TONE_OPTIONS[0],
    services: [],
    signatureServices: "",
    amenities: [],
    leadTime: "",
    diagnostics: [],
    doesNotDo: "",
    partsPolicy: "",
    tyres: "",
    bookingPreference: "Either",
    promotions: "",
    receptionistStyle: "",
    escalation: "",
    neverSay: "",
    extraNotes: "",
  };
}

// Wrap the brief as a delimited block to append to any AI system prompt.
// Returns "" when there's no brief, so call sites can append unconditionally.
export function aiBriefSystemBlock(brief: string | null | undefined): string {
  if (!brief || !brief.trim()) return "";
  return `\n\n--- ABOUT THIS GARAGE (use to tailor tone, services and what you can/can't offer; never contradict it) ---\n${brief.trim()}\n--- END ---`;
}
