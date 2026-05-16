import { NextResponse, type NextRequest } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { setChallenge } from "@/lib/webauthn/challenge";
import { getRpId, getRpName } from "@/lib/webauthn/config";

export async function POST(_req: NextRequest) {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("webauthn_credentials")
    .select("credential_id, transports")
    .eq("user_id", ctx.user.id);

  const options = await generateRegistrationOptions({
    rpName: getRpName(),
    rpID: getRpId(),
    userName: ctx.user.email ?? ctx.user.id,
    userDisplayName: ctx.user.fullName ?? ctx.user.email ?? "Staff user",
    userID: new TextEncoder().encode(ctx.user.id),
    attestationType: "none",
    excludeCredentials: (existing ?? []).map((c) => ({
      id: c.credential_id,
      transports: (c.transports ?? []) as AuthenticatorTransport[],
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  await setChallenge(options.challenge);
  return NextResponse.json(options);
}
