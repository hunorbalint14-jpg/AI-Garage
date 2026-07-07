import { Suspense } from "react";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { getStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { StaffShell } from "@/components/staff/staff-shell";
import { ColorSchemeSync } from "@/components/staff/color-scheme-sync";
import { NotificationsBell } from "@/components/staff/notifications-bell";
import {
  StreamedNotificationsBell,
  NotificationsBellFallback,
} from "@/components/staff/notifications-bell-slot";
import {
  listRecentNotifications,
  unreadNotificationCount,
  countUnreadTicketNotifications,
  latestUnreadTicketReply,
  TICKET_NOTIFICATION_KINDS,
} from "@/lib/staff-notifications";
import { countLiveOrgTickets } from "@/lib/support-tickets";
import { onBrandColor } from "@/components/staff/staff-modules";
import { SupportLauncher } from "@/components/staff/support/support-launcher";
import { SupportLauncherSlot } from "@/components/staff/support/support-launcher-slot";
import { headers as nextHeaders } from "next/headers";
import { redirect } from "next/navigation";
import { isDpaAccepted } from "@/lib/dpa";
import { isOwnerMfaEnforced, mfaAppliesToRole, hasVerifiedMfa, isMfaNudgeDismissed } from "@/lib/mfa";
import { isFeatureEnabled } from "@/lib/feature-flags";
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

// Workshop design fonts (UX review §1b) — scoped to /staff via the wrapper's
// CSS variables, same pattern as /admin. globals.css uses `@theme inline`, so
// font-sans → var(--font-sans) and font-mono → var(--font-geist-mono);
// override exactly those within the staff subtree. `contents` keeps the
// wrapper out of layout. Known limitation (shared with /admin): portalled
// overlays render outside this subtree and keep the root fonts.
const wsSans = Space_Grotesk({ subsets: ["latin"], variable: "--font-staff-sans" });
const wsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-staff-mono" });
const wsFontScope = {
  "--font-sans": "var(--font-staff-sans)",
  "--font-geist-mono": "var(--font-staff-mono)",
} as React.CSSProperties;

function StaffFonts({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${wsSans.variable} ${wsMono.variable} contents font-sans`} style={wsFontScope}>
      {children}
    </div>
  );
}

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getStaffContext();
  if (!ctx) return <StaffFonts>{children}</StaffFonts>;

  const fullName = ctx.user.fullName ?? ctx.user.email ?? "Staff";
  const role = ctx.orgRole ?? ctx.locationRole ?? "staff";
  const admin = createAdminClient();

  const reqHeaders = await nextHeaders();
  const pathname = reqHeaders.get("x-pathname") ?? "";

  // Post-login branch chooser + owner AI-setup survey render full-screen (no nav
  // shell, no gates) — they sit between sign-in and the portal; gates re-apply
  // once the user moves on.
  if (pathname.startsWith("/staff/select-branch") || pathname.startsWith("/staff/onboarding")) {
    return <StaffFonts>{children}</StaffFonts>;
  }

  const onAcceptancePage =
    pathname.startsWith("/staff/dpa-acceptance") || pathname.startsWith("/staff/login");
  const onMfaPage = pathname.startsWith("/staff/mfa") || pathname.startsWith("/staff/login");
  const mfaApplies = mfaAppliesToRole(ctx.orgRole) && !onMfaPage;
  const streaming = await isFeatureEnabled("streaming_dashboard");

  // The MFA step-up flag gates a redirect below, so it must resolve before we
  // render — it can't be deferred behind Suspense. Notifications are
  // display-only: when streaming, defer them behind a Suspense boundary so the
  // nav chrome paints before the two notification queries resolve; otherwise
  // fetch everything up front in parallel (the original behaviour).
  // Ticket-kind notifications belong to the support widget (badge + peek
  // toast); the bell excludes them so replies aren't double-badged.
  const launcherStaticProps = {
    brandColor: ctx.branding.primaryColor ?? "#6366f1",
    onBrand: onBrandColor(ctx.branding.primaryColor ?? "#6366f1"),
    firstName: fullName.split(/\s+/)[0] || "there",
    userEmail: ctx.user.email ?? null,
    role: ctx.orgRole ?? ctx.locationRole ?? "staff",
    branchName: ctx.location.name,
    buildSha: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
  };
  let bell: React.ReactNode;
  let launcher: React.ReactNode;
  let mfaVerified: boolean;
  if (streaming) {
    mfaVerified = mfaApplies ? await hasVerifiedMfa(ctx.user.id) : true;
    bell = (
      <Suspense fallback={<NotificationsBellFallback />}>
        <StreamedNotificationsBell
          locationId={ctx.location.id}
          excludeKinds={TICKET_NOTIFICATION_KINDS}
        />
      </Suspense>
    );
    launcher = (
      <SupportLauncherSlot
        userId={ctx.user.id}
        organizationId={ctx.organization.id}
        staticProps={launcherStaticProps}
      />
    );
  } else {
    const [unreadCount, recentNotifications, verified, unreadReplyCount, latestUnread, openTicketCount] =
      await Promise.all([
        unreadNotificationCount(ctx.location.id, { excludeKinds: TICKET_NOTIFICATION_KINDS }),
        listRecentNotifications(ctx.location.id, 8, { excludeKinds: TICKET_NOTIFICATION_KINDS }),
        mfaApplies ? hasVerifiedMfa(ctx.user.id) : Promise.resolve(true),
        countUnreadTicketNotifications(ctx.user.id),
        latestUnreadTicketReply(ctx.user.id),
        countLiveOrgTickets(ctx.organization.id),
      ]);
    mfaVerified = verified;
    bell = <NotificationsBell unreadCount={unreadCount} recent={recentNotifications} />;
    launcher = (
      <SupportLauncher
        {...launcherStaticProps}
        openTicketCount={openTicketCount}
        unreadReplyCount={unreadReplyCount}
        latestUnread={latestUnread}
      />
    );
  }
  // Branches the user can switch between come straight off the staff context.
  const locationsData = ctx.accessibleLocations;

  // DPA acceptance gate — skip on the acceptance page itself + login.
  if (!onAcceptancePage && !isDpaAccepted(ctx.branding.dpaVersion)) {
    redirect("/staff/dpa-acceptance");
  }

  // Owner AI-setup gate — a new owner completes the onboarding survey (which
  // generates their per-org AI brief) before reaching the dashboard. Owners
  // only; checked after DPA so legal acceptance comes first.
  if (ctx.orgRole === "owner" && !onAcceptancePage) {
    const { data: orgRow } = await admin
      .from("organizations")
      .select("ai_onboarded_at")
      .eq("id", ctx.organization.id)
      .maybeSingle();
    if (!(orgRow as { ai_onboarded_at: string | null } | null)?.ai_onboarded_at) {
      redirect("/staff/onboarding");
    }
  }

  // Owner/admin MFA gate. When OWNER_MFA_ENFORCED is on, owners/admins who
  // haven't cleared a passkey step-up this session go to /staff/mfa; otherwise a
  // nudge banner — but only for those without a credential yet (else it returns
  // on every reload even with nothing left to set up), and not while a recent
  // dismissal cookie is parked (checked first — it skips the credential query).
  let showMfaNudge = false;
  if (mfaApplies && !mfaVerified) {
    if (isOwnerMfaEnforced()) redirect("/staff/mfa");
    if (!(await isMfaNudgeDismissed(ctx.user.id))) {
      const { count } = await admin
        .from("webauthn_credentials")
        .select("id", { count: "exact", head: true })
        .eq("user_id", ctx.user.id);
      showMfaNudge = (count ?? 0) === 0;
    }
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
    <StaffFonts>
      <ColorSchemeSync dark={true} />
      {/* Shared fixed top-right cluster: support launcher + notifications
          bell. data-support-widget keeps the whole cluster out of the
          widget's screenshot capture. */}
      <div
        className="fixed top-2 right-3 z-40 flex items-center gap-2 sm:top-3 sm:right-4"
        data-support-widget
      >
        {launcher}
        {bell}
      </div>
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
        {showMfaNudge && <MfaNudge userId={ctx.user.id} />}
        {billingNudge && <TenantBillingNudge reason={billingNudge.reason} date={billingNudge.date} />}
        {children}
      </StaffShell>
    </StaffFonts>
  );
}
