import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { setChallenge } from "@/lib/webauthn/challenge";
import { getRpId } from "@/lib/webauthn/config";

export async function POST() {
  const options = await generateAuthenticationOptions({
    rpID: getRpId(),
    userVerification: "preferred",
    // Empty allowCredentials → discoverable credentials (resident keys); the
    // browser shows the user any passkey matching this RP ID.
    allowCredentials: [],
  });

  await setChallenge(options.challenge);
  return NextResponse.json(options);
}
