import { getStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { SignOutButton } from "./sign-out-button";
import { LocationSwitcher } from "@/components/staff/location-switcher";
import { StaffNav } from "@/components/staff/staff-nav";
import { AnimatedBackground } from "@/components/animated-background";

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
    .select("primary_color")
    .eq("id", ctx.organization.id)
    .single();
  const brandColor =
    (org as { primary_color: string } | null)?.primary_color ?? "#6366f1";

  return (
    <div className="relative flex min-h-screen bg-[#050c1a]">
      <AnimatedBackground brandColor={brandColor} />

      {/* Sidebar */}
      <aside className="relative z-10 flex w-60 shrink-0 flex-col border-r border-white/10 bg-[#0a1020]/90 backdrop-blur-xl">
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
          <OrgAvatar name={ctx.organization.name} color={brandColor} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight text-white">
              {ctx.organization.name}
            </p>
            <p className="text-xs capitalize text-gray-400">{role}</p>
          </div>
        </div>

        <div className="border-b border-white/10 px-3 py-3">
          <LocationSwitcher
            locations={locations ?? []}
            currentSlug={ctx.location.slug}
          />
        </div>

        <StaffNav />

        <div className="border-t border-white/10 px-4 py-4">
          <div className="mb-3 min-w-0">
            <p className="truncate text-sm font-medium text-white" title={fullName}>
              {fullName}
            </p>
            <p
              className="truncate text-xs text-gray-400"
              title={ctx.user.email ?? ""}
            >
              {ctx.user.email}
            </p>
          </div>
          <SignOutButton />
        </div>
      </aside>

      {/* Main content — light panel on dark background */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col bg-[#f8fafc]">
        <main className="flex-1 p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
