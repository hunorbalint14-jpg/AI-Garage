import { getStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { StaffShell } from "@/components/staff/staff-shell";
import { ColorSchemeSync } from "@/components/staff/color-scheme-sync";
import { NotificationsBell } from "@/components/staff/notifications-bell";
import { listRecentNotifications, unreadNotificationCount } from "@/lib/staff-notifications";
import { headers as nextHeaders } from "next/headers";
import { redirect } from "next/navigation";
import { isDpaAccepted } from "@/lib/dpa";
import { isOwnerMfaEnforced, mfaAppliesToRole, hasVerifiedMfa } from "@/lib/mfa";
import { MfaNudge } from "@/components/staff/mfa-nudge";
import { TenantBillingNudge } from "@/components/staff/tenant-billing-nudge";

type BillingNudge = { reason: "past_due" | "trial_ending"; date: string | null };

function computeBillingNudge(
  org: { tenant_subscription_status?: string | null; tenant_trial_end?: string | null } | null,
  eligible: boolean,
): BillingNudge | null {
  if (!eligible || !org) return null;
  if (org.tenant_subscription_status === "past_due") return { reason: "past_due", date: null };
  const trialEnd = org.tenant_trial_end ? new Date(org.tenant_trial_end) : null;
  const now = new Date();
  if (trialEnd && trialEnd > now && trialEnd.getTime() - now.getTime() < 7 * 24 * 60 * 60 * 1000) {
    return { reason: "trial_ending", date: trialEnd.toLocaleDateString("en-GB", { day: "numeric", month: "long" }) };
  }
  return null;
}

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getStaffContext();
  if (!ctx) return <>{children}</>;

  const fullName = ctx.user.fullName ?? ctx.user.email ?? "Staff";
  const role = ctx.orgRole ?? ctx.locationRole ?? "staff";

  const admin = createAdminClient();

  // Location-level staff see only their accessible locations; owners/admins see all
  let locationsData: { id: string; slug: string; name: string }[] = [];
  if (ctx.orgRole) {
    const { data } = await admin
      .from("locations")
      .select("id, slug, name")
      .eq("organization_id", ctx.organization.id)
      .order("created_at", { ascending: true });
    locationsData = data ?? [];
  } else {
    const { data: accessRows } = await admin
      .from("location_users")
      .select("location_id")
      .eq("user_id", ctx.user.id);
    const ids = (accessRows ?? []).map((r) => r.location_id);
    if (ids.length) {
      const { data } = await admin
        .from("locations")
        .select("id, slug, name")
        .in("id", ids)
        .order("created_at", { ascending: true });
      locationsData = data ?? [];
    }
  }

  const { data: org } = await admin
    .from("organizations")
    .select("primary_color, logo_url, dpa_version, tenant_subscription_status, tenant_trial_end")
    .eq("id", ctx.organization.id)
    .single();

  // DPA acceptance gate — skip check on the acceptance page itself + login
  const reqHeaders = await nextHeaders();
  const pathname = reqHeaders.get("x-pathname") ?? "";
  const onAcceptancePage =
    pathname.startsWith("/staff/dpa-acceptance") ||
    pathname.startsWith("/staff/login");
  if (
    !onAcceptancePage &&
    !isDpaAccepted((org as { dpa_version?: string } | null)?.dpa_version)
  ) {
    redirect("/staff/dpa-acceptance");
  }

  // Owner/admin MFA gate. Mirrors the DPA gate above. When OWNER_MFA_ENFORCED
  // is on, owners/admins who haven't cleared a passkey step-up this session are
  // sent to /staff/mfa; otherwise we just surface a nudge banner.
  const onMfaPage =
    pathname.startsWith("/staff/mfa") || pathname.startsWith("/staff/login");
  let showMfaNudge = false;
  let mfaHasPasskey = false;
  if (mfaAppliesToRole(ctx.orgRole) && !onMfaPage) {
    const verified = await hasVerifiedMfa(ctx.user.id);
    if (!verified) {
      const { count } = await admin
        .from("webauthn_credentials")
        .select("id", { count: "exact", head: true })
        .eq("user_id", ctx.user.id);
      mfaHasPasskey = (count ?? 0) > 0;
      if (isOwnerMfaEnforced()) redirect("/staff/mfa");
      showMfaNudge = true;
    }
  }

  // Owner billing nudge: payment past-due, or a Pro trial ending within 7 days.
  const billingNudge = computeBillingNudge(
    org as { tenant_subscription_status?: string | null; tenant_trial_end?: string | null } | null,
    ctx.orgRole === "owner" && !pathname.startsWith("/staff/settings/billing"),
  );

  const brandColor =
    (org as { primary_color: string } | null)?.primary_color ?? "#6366f1";
  const orgLogoUrl =
    (org as { logo_url?: string | null } | null)?.logo_url ?? null;

  const orgInitials = ctx.organization.name
    .split(/\s+/)
    .map((w: string) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const userInitials = fullName
    .split(/\s+/)
    .map((w: string) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const [unreadCount, recentNotifications] = await Promise.all([
    unreadNotificationCount(ctx.location.id),
    listRecentNotifications(ctx.location.id, 8),
  ]);

  return (
    <>
      <ColorSchemeSync dark={true} />
      <NotificationsBell unreadCount={unreadCount} recent={recentNotifications} />
      <StaffShell
        brandColor={brandColor}
        orgRole={ctx.orgRole}
        locationPermissions={ctx.locationPermissions}
        orgName={ctx.organization.name}
        orgInitials={orgInitials}
        orgLogoUrl={orgLogoUrl}
        userName={fullName}
        userEmail={ctx.user.email ?? null}
        userInitials={userInitials}
        locations={locationsData}
        currentSlug={ctx.location.slug}
        role={role}
      >
        {showMfaNudge && <MfaNudge hasPasskey={mfaHasPasskey} />}
        {billingNudge && <TenantBillingNudge reason={billingNudge.reason} date={billingNudge.date} />}
        {children}
      </StaffShell>
    </>
  );
}
