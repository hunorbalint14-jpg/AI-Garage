import { getStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { SignOutButton } from "./sign-out-button";
import { LocationSwitcher } from "@/components/staff/location-switcher";
import { StaffNav } from "@/components/staff/staff-nav";

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
    (org as { primary_color: string } | null)?.primary_color ?? "#1f2937";

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="flex w-60 shrink-0 flex-col border-r bg-card">
        <div className="flex items-center gap-3 border-b px-4 py-4">
          <OrgAvatar name={ctx.organization.name} color={brandColor} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">
              {ctx.organization.name}
            </p>
            <p className="text-xs capitalize text-muted-foreground">{role}</p>
          </div>
        </div>

        <div className="border-b px-3 py-3">
          <LocationSwitcher
            locations={locations ?? []}
            currentSlug={ctx.location.slug}
          />
        </div>

        {/* StaffNav is a client component that owns its icon imports —
            icons cannot be passed as props from server to client components */}
        <StaffNav />

        <div className="border-t px-4 py-4">
          <div className="mb-3 min-w-0">
            <p className="truncate text-sm font-medium" title={fullName}>
              {fullName}
            </p>
            <p
              className="truncate text-xs text-muted-foreground"
              title={ctx.user.email ?? ""}
            >
              {ctx.user.email}
            </p>
          </div>
          <SignOutButton />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex-1 p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
