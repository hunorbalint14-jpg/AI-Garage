import { getStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { StaffShell } from "@/components/staff/staff-shell";
import { ColorSchemeSync } from "@/components/staff/color-scheme-sync";
import { NotificationsBell } from "@/components/staff/notifications-bell";
import { listRecentNotifications, unreadNotificationCount } from "@/lib/staff-notifications";
import { headers as nextHeaders } from "next/headers";
import { redirect } from "next/navigation";
import { isDpaAccepted } from "@/lib/dpa";

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
    .select("primary_color, logo_url, dpa_version")
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
        {children}
      </StaffShell>
    </>
  );
}
