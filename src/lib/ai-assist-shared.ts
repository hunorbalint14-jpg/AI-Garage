// Client-safe types for the AI assist (rewrite) feature. The server half —
// the Anthropic call — lives in ai-assist.ts; keep this file free of server
// imports so client components can use the types.

export type AssistChannel = "email" | "sms" | "generic";

export type AssistPreset = {
  label: string;
  instruction: string;
};

// The fixed rewrite operations offered by the AI assist menu. The instruction
// is sent verbatim to the model alongside the user's text.
export const ASSIST_PRESETS: AssistPreset[] = [
  { label: "Improve writing", instruction: "Improve the writing: clearer, tighter, better flow. Keep the same meaning and tone." },
  { label: "Friendlier tone", instruction: "Make the tone warmer and friendlier." },
  { label: "More formal tone", instruction: "Make the tone more formal and professional." },
  { label: "Shorten", instruction: "Make it significantly shorter while keeping every key fact." },
  { label: "Fix spelling & grammar", instruction: "Fix spelling, grammar and punctuation only. Change nothing else." },
];

export const ASSIST_MAX_TEXT = 4000;
export const ASSIST_MAX_INSTRUCTION = 300;
