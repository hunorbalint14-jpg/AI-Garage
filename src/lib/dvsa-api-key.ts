// The DVSA MOT History API key, sent as `X-API-Key` alongside the OAuth token
// from dvla-auth.ts.
//
// The code has always read DVSA_API_KEY, but the production env checklist and
// docs named it DVSA_MOT_API_KEY — so an environment configured from the docs
// had every MOT lookup, recall check and the nightly MOT sync failing with
// "not configured" while the checklist showed the group as set. Accept either
// name so whichever one was actually put in Vercel works.
//
// Kept out of dvla-auth.ts on purpose: tests mock that module wholesale.
export function dvsaApiKey(): string | undefined {
  return process.env.DVSA_API_KEY?.trim() || process.env.DVSA_MOT_API_KEY?.trim() || undefined;
}
