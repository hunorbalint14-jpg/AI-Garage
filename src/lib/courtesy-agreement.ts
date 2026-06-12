// Courtesy car loan agreement. Bump the version when wording changes — each
// loan pins the version it was signed against, so old signatures keep
// meaning what they meant.

export const AGREEMENT_VERSION = "2026-06-v1";

export function agreementText(garageName: string): string {
  return `I confirm I hold a full valid UK driving licence and am insured to drive the courtesy vehicle provided by ${garageName}. I agree to return it on request with the same fuel level, accept responsibility for any fines, charges or damage (fair wear excepted) incurred while it is in my care, and consent to ${garageName} verifying my licence using the DVLA share code I have provided.`;
}
