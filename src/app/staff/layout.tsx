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
  billing: { tenant_subscription_status?: string | null; tenant_trial_end?: string | null } | null,
  eligible: boolean,
): BillingNudge | null {
  if (!eligible || !billing) return null;
  if (billing.tenant_subscription_status === "past_due") return { reason: "past_due", date: null };
  const trialEnd = billing.tenant_trial_end ? new Date(billing.tenant_trial_end) : null;
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

  const reqHeaders = await nextHeaders();
  const pathname = reqHeaders.get("x-pathname") ?? "";
  const onAcceptancePage =
    pathname.startsWith("/staff/dpa-acceptance") || pathname.startsWith("/staff/login");
  const onMfaPage = pathname.startsWith("/staff/mfa") || pathname.startsWith("/staff/login");
  const mfaApplies = mfaAppliesToRole(ctx.orgRole) && !onMfaPage;

  // Independent reads in parallel (previously a sequential waterfall): locations,
  // notifications, and — when relevant — the MFA step-up flag. Branding + DPA
  // version now ride along on the staff context, so the separate org query is gone.
  const [unreadCount, recentNotifications, mfaVerified] = await Promise.all([
    unreadNotificationCount(ctx.location.id),
    listRecentNotifications(ctx.location.id, 8),
    mfaApplies ? hasVerifiedMfa(ctx.user.id) : Promise.resolve(true),
  ]);
  // Branches the user can switch between come straight off the staff context.
  const locationsData = ctx.accessibleLocations;

  // DPA acceptance gate — skip on the acceptance page itself + login.
  if (!onAcceptancePage && !isDpaAccepted(ctx.branding.dpaVersion)) {
    redirect("/staff/dpa-acceptance");
  }

  // Owner/admin MFA gate. When OWNER_MFA_ENFORCED is on, owners/admins who
  // haven't cleared a passkey step-up this session go to /staff/mfa; otherwise a
  // nudge banner — but only for those without a credential yet (else it returns
  // on every reload even with nothing left to set up).
  let showMfaNudge = false;
  if (mfaApplies && !mfaVerified) {
    if (isOwnerMfaEnforced()) redirect("/staff/mfa");
    const { count } = await admin
      .from("webauthn_credentials")
      .select("id", { count: "exact", head: true })
      .eq("user_id", ctx.user.id);
    showMfaNudge = (count ?? 0) === 0;
  }

  // Owner billing nudge: payment past-due, or a Pro trial ending within 7 days.
  const billingNudge = computeBillingNudge(
    ctx.tenantBilling,
    ctx.orgRole === "owner" && !pathname.startsWith("/staff/settings/billing"),
  );

  const brandColor = ctx.branding.primaryColor ?? "#6366f1";
  const orgLogoUrl = ctx.branding.logoUrl;

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
        currentLocationId={ctx.activeLocation.id}
        role={role}
      >
        {showMfaNudge && <MfaNudge />}
        {billingNudge && <TenantBillingNudge reason={billingNudge.reason} date={billingNudge.date} />}
        {children}
      </StaffShell>
    </>
  );
}
