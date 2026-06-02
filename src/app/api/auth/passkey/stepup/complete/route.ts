import { NextResponse, type NextRequest } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { getChallenge, clearChallenge } from "@/lib/webauthn/challenge";
import { getRpId, isOriginAllowed } from "@/lib/webauthn/config";
import { logAudit } from "@/lib/audit";
import { MFA_COOKIE, makeMfaValue } from "@/lib/mfa-cookie";

function publicKeyToUint8(input: unknown): Uint8Array {
  if (input instanceof Uint8Array) return input;
  if (Array.isArray(input)) return Uint8Array.from(input as number[]);
  if (typeof input === "string") {
    if (!input.startsWith("\\x")) {
      return new Uint8Array(Buffer.from(input, "base64"));
    }
    const hex = input.slice(2);
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    }
    return out;
  }
  return new Uint8Array(0);
}

// Verify a step-up assertion for the current staff user and set the signed,
// user-bound ai_mfa_verified cookie. Does NOT mint a session — the user is
// already authenticated; this only records that they cleared MFA this session.
export async function POST(req: NextRequest) {
  const ctx = await requireStaffContext();

  const body = await req.json();
  const assertion = body.assertion;
  if (!assertion?.id) {
    return NextResponse.json({ error: "Invalid assertion." }, { status: 400 });
  }

  const challenge = await getChallenge();
  if (!challenge) {
    return NextResponse.json({ error: "Challenge missing or expired." }, { status: 400 });
  }

  const origin = req.headers.get("origin") ?? "";
  if (!isOriginAllowed(origin)) {
    return NextResponse.json({ error: "Origin not allowed." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: credential } = await admin
    .from("webauthn_credentials")
    .select("user_id, credential_id, public_key, counter, transports")
    .eq("credential_id", assertion.id)
    .maybeSingle();

  // The credential must belong to the signed-in user — block stepping up with
  // someone else's passkey.
  if (!credential || credential.user_id !== ctx.user.id) {
    await clearChallenge();
    return NextResponse.json({ error: "Passkey not recognised." }, { status: 401 });
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: getRpId(),
      credential: {
        id: credential.credential_id,
        publicKey: publicKeyToUint8(credential.public_key) as Uint8Array<ArrayBuffer>,
        counter: Number(credential.counter),
        transports: (credential.transports ?? []) as AuthenticatorTransport[],
      },
    });
  } catch (e) {
    await clearChallenge();
    return NextResponse.json({ error: `Verification failed: ${(e as Error).message}` }, { status: 401 });
  }

  if (!verification.verified) {
    await clearChallenge();
    return NextResponse.json({ error: "Verification failed." }, { status: 401 });
  }

  await admin
    .from("webauthn_credentials")
    .update({
      counter: verification.authenticationInfo.newCounter,
      last_used_at: new Date().toISOString(),
    })
    .eq("credential_id", credential.credential_id);

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "auth.mfa_verified",
    metadata: { method: "passkey", role: ctx.orgRole },
  });

  await clearChallenge();

  const res = NextResponse.json({ success: true });
  res.cookies.set(MFA_COOKIE, await makeMfaValue(ctx.user.id, Date.now()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
  return res;
}
