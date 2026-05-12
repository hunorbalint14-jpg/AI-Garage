export const CURRENT_DPA_VERSION = "1.0";
export const CURRENT_DPA_EFFECTIVE_DATE = "May 2026";

export function isDpaAccepted(version: string | null | undefined): boolean {
  return version === CURRENT_DPA_VERSION;
}
