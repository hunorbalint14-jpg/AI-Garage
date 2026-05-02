import Link from "next/link";
import { getStaffContext } from "@/lib/staff-context";
import { SignOutButton } from "./sign-out-button";

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getStaffContext();

  // Unauthenticated routes under /staff (i.e. /staff/login) render plain
  // without the sidebar. The login page handles its own UI.
  if (!ctx) return <>{children}</>;

  const fullName = ctx.user.fullName ?? ctx.user.email ?? "Staff";
  const orgName = ctx.organization.name;
  const locationName = ctx.location.name;
  const showLocationLine = locationName && locationName !== orgName;
  const role = ctx.orgRole ?? ctx.locationRole ?? "staff";

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col border-r bg-muted/40 p-4">
        <div className="mb-1 text-lg font-semibold leading-tight">{orgName}</div>
        {showLocationLine && (
          <div className="mb-1 text-sm text-muted-foreground">
            {locationName}
          </div>
        )}
        <div className="mb-6 text-xs text-muted-foreground capitalize">
          {role}
        </div>

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
