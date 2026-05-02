import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "./sign-out-button";

type Membership = {
  role: string;
  garage: { id: string; name: string; slug: string } | null;
};

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Unauthenticated routes under /staff (i.e. /staff/login) render plain
  // without the sidebar. The login page handles its own UI.
  if (!user) {
    return <>{children}</>;
  }

  const { data: membership } = (await supabase
    .from("garage_users")
    .select("role, garage:garages(id, name, slug)")
    .eq("user_id", user.id)
    .maybeSingle()) as { data: Membership | null };

  const fullName =
    (user.user_metadata?.full_name as string | undefined) ??
    user.email ??
    "Staff";
  const garageName = membership?.garage?.name ?? "Staff portal";

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col border-r bg-muted/40 p-4">
        <div className="mb-1 text-lg font-semibold leading-tight">
          {garageName}
        </div>
        <div className="mb-6 text-xs text-muted-foreground capitalize">
          {membership?.role ?? "staff"}
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
            title={user.email ?? ""}
          >
            {user.email}
          </div>
          <SignOutButton />
        </div>
      </aside>
      <div className="flex-1 p-6">{children}</div>
    </div>
  );
}
