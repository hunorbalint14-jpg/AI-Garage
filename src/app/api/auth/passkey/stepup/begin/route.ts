import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { setChallenge } from "@/lib/webauthn/challenge";
import { getRpId } from "@/lib/webauthn/config";
import { enforceRateLimit } from "@/lib/rate-limit";

// Step-up: prove possession of a passkey for the ALREADY-authenticated staff
// user (MFA), without minting a new session. Unlike login/begin this restricts
// allowCredentials to the current user's own credentials.
export async function POST() {
  const ctx = await requireStaffContext();

  const limited = await enforceRateLimit("login");
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many attempts." },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }

  const admin = createAdminClient();
  const { data: creds } = await admin
    .from("webauthn_credentials")
    .select("credential_id, transports")
    .eq("user_id", ctx.user.id);

  if (!creds || creds.length === 0) {
    return NextResponse.json({ error: "No passkey registered." }, { status: 400 });
  }

  const options = await generateAuthenticationOptions({
    rpID: getRpId(),
    userVerification: "preferred",
    allowCredentials: creds.map((c) => ({
      id: c.credential_id,
      transports: (c.transports ?? []) as AuthenticatorTransport[],
    })),
  });

  await setChallenge(options.challenge);
  return NextResponse.json(options);
}
