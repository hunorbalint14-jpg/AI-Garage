import { getStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { SignOutButton } from "./sign-out-button";
import { LocationSwitcher } from "@/components/staff/location-switcher";
import { StaffNav } from "@/components/staff/staff-nav";
import { AnimatedBackground } from "@/components/animated-background";
import { PORTAL_THEMES, type PortalTheme } from "@/lib/portal-themes";
import { ColorSchemeSync } from "@/components/staff/color-scheme-sync";

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
  const isWorkshop = theme === "workshop";

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

  const workshopOnBrand = (() => {
    try {
      const h = brandColor.replace("#", "");
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.45 ? "#0e1014" : "#e6e8eb";
    } catch { return "#0e1014"; }
  })();

  return (
    <div className={cfg.outer}>
      <ColorSchemeSync dark={isDark} />
      {cfg.showBlobs && (
        <AnimatedBackground
          brandColor={brandColor}
          intensity={cfg.blobIntensity}
        />
      )}

      {/* Sidebar */}
      <aside className={cfg.sidebar}>
        {/* Header */}
        {isWorkshop ? (
          <div className="flex items-center gap-3 border-b border-[#2a2f37] px-4 py-4">
            <div
              style={{
                width: 30,
                height: 30,
                background: brandColor,
                color: workshopOnBrand,
                display: "grid",
                placeItems: "center",
                fontWeight: 800,
                fontSize: 13,
                clipPath: "polygon(0 0, 100% 0, 100% 78%, 78% 100%, 0 100%)",
                fontFamily: "var(--font-geist-mono, monospace)",
                flexShrink: 0,
              }}
            >
              {orgInitials}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight text-[#e6e8eb]">
                {ctx.organization.name}
              </p>
              <p className="font-mono text-[10px] uppercase tracking-widest text-[#5a6170]">
                {role.toUpperCase()} · ON SHIFT
              </p>
            </div>
          </div>
        ) : (
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
        )}

        <div className={`border-b ${cfg.sidebarBorder} px-3 py-3`}>
          <LocationSwitcher
            locations={locationsData}
            currentSlug={ctx.location.slug}
            dark={isDark}
          />
        </div>

        <StaffNav theme={theme} brandColor={brandColor} orgRole={ctx.orgRole} />

        {/* Footer */}
        {isWorkshop ? (
          <div className="border-t border-[#2a2f37] px-4 py-3">
            <div className="mb-3 flex items-center gap-3">
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 99,
                  background: `${brandColor}22`,
                  color: brandColor,
                  display: "grid",
                  placeItems: "center",
                  fontWeight: 700,
                  fontSize: 11,
                  fontFamily: "var(--font-geist-mono, monospace)",
                  flexShrink: 0,
                }}
              >
                {userInitials}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[#e6e8eb]">
                  {fullName}
                </p>
                <p
                  className="truncate font-mono text-[10px] text-[#5a6170]"
                  title={ctx.user.email ?? ""}
                >
                  {ctx.user.email}
                </p>
              </div>
            </div>
            <SignOutButton dark={true} />
          </div>
        ) : (
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
        )}
      </aside>

      {/* Main content */}
      <div className={cfg.content}>
        <main className="flex-1 p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
