import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage, type AiUsageContext } from "@/lib/ai-usage";
import { createAdminClient } from "@/lib/supabase/admin";

const anthropic = new Anthropic();
const MODEL = "claude-haiku-4-5-20251001";

// The onboarding survey an owner completes once. Answers are stored as
// organizations.ai_profile (jsonb) and distilled into organizations.ai_brief,
// which every AI feature injects into its prompt (see aiBriefSystemBlock).

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

const BRIEF_SYSTEM = `You write a concise internal brief that OTHER AI assistants (a customer-facing receptionist, an email/SMS/marketing copywriter, a diagnostic helper, and a labour-time estimator) will read as background context about a single UK garage.

Write 120–180 words of plain text (no markdown, no headings, no bullet symbols). Use clear, instructional sentences in the second person ("This garage…", "Keep the tone…", "Do not offer…"). Cover, where the answers allow: what the garage specialises in and offers; the tone/voice to use in customer messages; services it actively promotes; what it does NOT do (so assistants never promise it); diagnostic/capability notes; parts and tyre policy; how customers should book; and any "never say" rules. Omit anything not provided — never invent facts, prices, or guarantees. British English.`;

// Distil the survey answers into the reusable brief. Best-effort: callers should
// fall back to no brief on throw.
export async function generateAiBrief(
  garageName: string,
  answers: AiProfileAnswers,
  ctx?: AiUsageContext,
): Promise<string> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 500,
    system: [{ type: "text", text: BRIEF_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: `Garage name: ${garageName}\n\nSurvey answers (JSON):\n${JSON.stringify(answers, null, 2)}\n\nWrite the brief.`,
      },
    ],
  });
  if (ctx) await recordAiUsage({ ...ctx, model: MODEL, usage: response.usage });

  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type from Claude");
  return block.text.trim();
}

// Fetch an org's saved brief (null when not onboarded). Used by AI surfaces to
// tailor their output.
export async function getOrgAiBrief(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("organizations")
    .select("ai_brief")
    .eq("id", organizationId)
    .maybeSingle();
  const brief = (data as { ai_brief: string | null } | null)?.ai_brief ?? null;
  return brief && brief.trim() ? brief.trim() : null;
}

// Wrap the brief as a delimited block to append to any AI system prompt.
// Returns "" when there's no brief, so call sites can append unconditionally.
export function aiBriefSystemBlock(brief: string | null | undefined): string {
  if (!brief || !brief.trim()) return "";
  return `\n\n--- ABOUT THIS GARAGE (use to tailor tone, services and what you can/can't offer; never contradict it) ---\n${brief.trim()}\n--- END ---`;
}
