import { cookies } from "next/headers";
import { MFA_COOKIE, readMfaUser } from "@/lib/mfa-cookie";

// Owner/admin MFA enforcement. Passkey step-up is always available to set up;
// hard-blocking is gated behind OWNER_MFA_ENFORCED so we can ship the flow,
// nudge owners to enrol, then flip enforcement on once they have.

// Org-level roles that must complete MFA. Owners + admins + the finance-scoped
// accountant (all have org-wide access worth a step-up).
export function mfaAppliesToRole(orgRole: "owner" | "admin" | "accountant" | null): boolean {
  return orgRole === "owner" || orgRole === "admin" || orgRole === "accountant";
}

// Hard block when true; nudge-only when false (default). Set OWNER_MFA_ENFORCED
// = "true" in the environment to enforce.
export function isOwnerMfaEnforced(): boolean {
  return process.env.OWNER_MFA_ENFORCED === "true";
}

// Has this user completed a passkey step-up this session? Reads the signed,
// user-bound ai_mfa_verified cookie.
export async function hasVerifiedMfa(userId: string): Promise<boolean> {
  const store = await cookies();
  const raw = store.get(MFA_COOKIE)?.value;
  return (await readMfaUser(raw)) === userId;
}
