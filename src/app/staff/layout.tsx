import Link from "next/link";
import { getStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { SignOutButton } from "./sign-out-button";
import { LocationSwitcher } from "@/components/staff/location-switcher";

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getStaffContext();

  if (!ctx) return <>{children}</>;

  const fullName = ctx.user.fullName ?? ctx.user.email ?? "Staff";
  const orgName = ctx.organization.name;
  const role = ctx.orgRole ?? ctx.locationRole ?? "staff";

  // Fetch all locations in this org so the switcher can list them
  const admin = createAdminClient();
  const { data: locations } = await admin
    .from("locations")
    .select("id, slug, name")
    .eq("organization_id", ctx.organization.id)
    .order("created_at", { ascending: true });

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col border-r bg-muted/40 p-4">
        <div className="mb-1 text-lg font-semibold leading-tight">{orgName}</div>
        <div className="mb-3 text-xs text-muted-foreground capitalize">
          {role}
        </div>

        <LocationSwitcher
          locations={locations ?? []}
          currentSlug={ctx.location.slug}
        />

        <nav className="flex flex-col gap-1 text-sm">
          <Link href="/staff" className="rounded px-2 py-1 hover:bg-muted">
            Dashboard
          </Link>
          <Link
            href="/staff/customers"
            className="rounded px-2 py-1 hover:bg-muted"
          >
            Customers
          </Link>
          <Link
            href="/staff/reminders"
            className="rounded px-2 py-1 hover:bg-muted"
          >
            Reminders
          </Link>
          <Link
            href="/staff/settings"
            className="rounded px-2 py-1 hover:bg-muted"
          >
            Settings
          </Link>
        </nav>

        <div className="mt-auto flex flex-col gap-2 border-t pt-4">
          <div className="truncate text-sm font-medium" title={fullName}>
            {fullName}
          </div>
          <div
            className="truncate text-xs text-muted-foreground"
            title={ctx.user.email ?? ""}
          >
            {ctx.user.email}
          </div>
          <SignOutButton />
        </div>
      </aside>
      <div className="flex-1 p-6">{children}</div>
    </div>
  );
}
