import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { PasskeysSection, type PasskeyRow } from "../settings/passkeys-section";
import { AccountTabs, isAccountTab } from "./account-tabs";
import { ProfileForm } from "./profile-form";
import { PasswordForm } from "./password-form";
import { NotificationsForm } from "./notifications-form";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: tabParam } = await searchParams;
  const tab = isAccountTab(tabParam) ? tabParam : "profile";

  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const [passkeysRes, prefRes] = await Promise.all([
    admin
      .from("webauthn_credentials")
      .select("credential_id, device_name, created_at, last_used_at")
      .eq("user_id", ctx.user.id)
      .order("created_at", { ascending: false }),
    admin
      .from("staff_notification_prefs")
      .select("weekly_digest")
      .eq("user_id", ctx.user.id)
      .maybeSingle(),
  ]);

  const passkeys = (passkeysRes.data ?? []) as PasskeyRow[];
  const weeklyDigest = (prefRes.data as { weekly_digest: boolean } | null)?.weekly_digest ?? true;

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Your account</h1>
        <p className="text-sm text-muted-foreground">
          Manage your personal profile, sign-in security and notifications.
        </p>
      </div>

      <AccountTabs active={tab} />

      {tab === "profile" && (
        <ProfileForm initialName={ctx.user.fullName ?? ""} email={ctx.user.email ?? ""} />
      )}

      {tab === "security" && (
        <>
          <PasskeysSection initialPasskeys={passkeys} />
          <PasswordForm />
        </>
      )}

      {tab === "notifications" && <NotificationsForm weeklyDigest={weeklyDigest} />}
    </div>
  );
}
