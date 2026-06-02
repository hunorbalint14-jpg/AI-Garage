import { ShieldCheck } from "lucide-react";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOwnerMfaEnforced, mfaAppliesToRole } from "@/lib/mfa";
import { MfaClient } from "./mfa-client";

export default async function StaffMfaPage() {
  const ctx = await requireStaffContext();

  const admin = createAdminClient();
  const { count } = await admin
    .from("webauthn_credentials")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ctx.user.id);
  const hasPasskey = (count ?? 0) > 0;

  const applies = mfaAppliesToRole(ctx.orgRole);
  const enforced = isOwnerMfaEnforced();

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-6 px-6 py-10 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
        <ShieldCheck className="h-7 w-7 text-primary" />
      </div>

      <div>
        <h1 className="text-2xl font-bold">
          {hasPasskey ? "Verify it's you" : "Secure your account"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {hasPasskey
            ? "Confirm your identity with your passkey to continue."
            : applies
              ? "As an account owner/admin, set up a passkey for two-factor sign-in. It only takes a moment and uses your device's fingerprint, face, or PIN."
              : "Add a passkey for faster, phishing-resistant sign-in."}
        </p>
        {applies && !enforced && (
          <p className="mt-2 text-xs text-muted-foreground">
            This isn&apos;t required yet, but will be soon — setting it up now avoids interruption later.
          </p>
        )}
      </div>

      <MfaClient hasPasskey={hasPasskey} canSkip={applies && !enforced} />
    </div>
  );
}
