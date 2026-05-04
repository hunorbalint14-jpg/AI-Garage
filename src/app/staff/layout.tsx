import { getStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { SignOutButton } from "./sign-out-button";
import { LocationSwitcher } from "@/components/staff/location-switcher";
import { StaffNav } from "@/components/staff/staff-nav";
import { AnimatedBackground } from "@/components/animated-background";
import { PORTAL_THEMES, type PortalTheme } from "@/lib/portal-themes";

function OrgAvatar({ name, color }: { name: string; color: string }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  return (
    <div
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
      style={{ backgroundColor: color }}
    >
      {initials}
    </div>
  );
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
  const { data: locations } = await admin
    .from("locations")
    .select("id, slug, name")
    .eq("organization_id", ctx.organization.id)
    .order("created_at", { ascending: true });

  const { data: org } = await admin
    .from("organizations")
    .select("primary_color, portal_theme")
    .eq("id", ctx.organization.id)
    .single();

  const brandColor =
    (org as { primary_color: string } | null)?.primary_color ?? "#6366f1";
  const theme: PortalTheme =
    ((org as { portal_theme?: string } | null)?.portal_theme as PortalTheme) ??
    "dark";
  const cfg = PORTAL_THEMES[theme];

  const isDark = theme !== "light";

  return (
    <div className={cfg.outer}>
      {cfg.showBlobs && (
        <AnimatedBackground
          brandColor={brandColor}
          intensity={cfg.blobIntensity}
        />
      )}

      {/* Sidebar */}
      <aside className={cfg.sidebar}>
        <div
          className={`flex items-center gap-3 border-b ${cfg.sidebarBorder} px-4 py-4`}
        >
          <OrgAvatar name={ctx.organization.name} color={brandColor} />
          <div className="min-w-0">
            <p
              className={`truncate text-sm font-semibold leading-tight ${cfg.sidebarText}`}
            >
              {ctx.organization.name}
            </p>
            <p className={`text-xs capitalize ${cfg.sidebarSubtext}`}>
              {role}
            </p>
          </div>
        </div>

        <div className={`border-b ${cfg.sidebarBorder} px-3 py-3`}>
          <LocationSwitcher
            locations={locations ?? []}
            currentSlug={ctx.location.slug}
            dark={isDark}
          />
        </div>

        <StaffNav theme={theme} brandColor={brandColor} orgRole={ctx.orgRole} />

        <div className={`border-t ${cfg.sidebarBorder} px-4 py-4`}>
          <div className="mb-3 min-w-0">
            <p
              className={`truncate text-sm font-medium ${cfg.sidebarText}`}
              title={fullName}
            >
              {fullName}
            </p>
            <p
              className={`truncate text-xs ${cfg.sidebarSubtext}`}
              title={ctx.user.email ?? ""}
            >
              {ctx.user.email}
            </p>
          </div>
          <SignOutButton dark={isDark} />
        </div>
      </aside>

      {/* Main content */}
      <div className={cfg.content}>
        <main className="flex-1 p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
