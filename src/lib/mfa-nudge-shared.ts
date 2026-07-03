// Shared between the server layout gate (src/lib/mfa.ts) and the client banner
// (src/components/staff/mfa-nudge.tsx), which must not transitively import
// next/headers — keep this module dependency-free.

export const MFA_NUDGE_DISMISSED_COOKIE = "ai_mfa_nudge_dismissed";

// Dismissing the banner parks it for this long (per user, per browser), then it
// returns — a reminder cadence, not a permanent opt-out, since MFA enforcement
// is coming for these roles.
export const MFA_NUDGE_RENAG_DAYS = 14;
