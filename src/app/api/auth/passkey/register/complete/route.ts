import { NextResponse, type NextRequest } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { getChallenge, clearChallenge } from "@/lib/webauthn/challenge";
import { getRpId, isOriginAllowed } from "@/lib/webauthn/config";

export async function POST(req: NextRequest) {
  const ctx = await requireStaffContext();
  const body = await req.json();
  const deviceName: string | null = body.deviceName ?? null;

  const challenge = await getChallenge();
  if (!challenge) {
    return NextResponse.json({ error: "Challenge missing or expired." }, { status: 400 });
  }

  const origin = req.headers.get("origin") ?? "";
  if (!isOriginAllowed(origin)) {
    return NextResponse.json({ error: "Origin not allowed." }, { status: 400 });
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.attestation,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: getRpId(),
    });
  } catch (e) {
    await clearChallenge();
    return NextResponse.json({ error: `Verification failed: ${(e as Error).message}` }, { status: 400 });
  }

  if (!verification.verified || !verification.registrationInfo) {
    await clearChallenge();
    return NextResponse.json({ error: "Verification not successful." }, { status: 400 });
  }

  const { credential } = verification.registrationInfo;
  const admin = createAdminClient();

  const { error } = await admin.from("webauthn_credentials").insert({
    user_id: ctx.user.id,
    credential_id: credential.id,
    public_key: Buffer.from(credential.publicKey).toString("base64"),
    counter: credential.counter,
    transports: credential.transports ?? null,
    device_name: deviceName,
  });
  if (error) {
    await clearChallenge();
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await clearChallenge();
  return NextResponse.json({ success: true });
}
