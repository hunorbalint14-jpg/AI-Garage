import { NextResponse, type NextRequest } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getChallenge, clearChallenge } from "@/lib/webauthn/challenge";
import { getRpId, isOriginAllowed } from "@/lib/webauthn/config";

export async function POST(req: NextRequest) {
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

  if (!credential) {
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
        publicKey: new Uint8Array(credential.public_key),
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

  // Update counter and last used
  await admin
    .from("webauthn_credentials")
    .update({
      counter: verification.authenticationInfo.newCounter,
      last_used_at: new Date().toISOString(),
    })
    .eq("credential_id", credential.credential_id);

  // Mint Supabase session: generateLink → verifyOtp pattern
  const { data: authUser } = await admin.auth.admin.getUserById(credential.user_id);
  if (!authUser?.user?.email) {
    await clearChallenge();
    return NextResponse.json({ error: "Auth user has no email." }, { status: 500 });
  }

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: authUser.user.email,
  });
  if (linkErr) {
    await clearChallenge();
    return NextResponse.json({ error: linkErr.message }, { status: 500 });
  }
  const tokenHash = linkData.properties?.hashed_token;
  if (!tokenHash) {
    await clearChallenge();
    return NextResponse.json({ error: "No token returned." }, { status: 500 });
  }

  const supabase = await createClient();
  const { error: verifyOtpErr } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (verifyOtpErr) {
    await clearChallenge();
    return NextResponse.json({ error: verifyOtpErr.message }, { status: 500 });
  }

  await clearChallenge();
  return NextResponse.json({ success: true, redirect: "/staff" });
}
