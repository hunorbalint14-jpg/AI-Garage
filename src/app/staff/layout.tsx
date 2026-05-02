import Link from "next/link";

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 border-r bg-muted/40 p-4">
        <div className="mb-6 text-lg font-semibold">Garage Admin</div>
        <nav className="flex flex-col gap-1 text-sm">
          <Link href="/staff" className="rounded px-2 py-1 hover:bg-muted">
            Dashboard
          </Link>
          <Link href="/staff/customers" className="rounded px-2 py-1 hover:bg-muted">
            Customers
          </Link>
          <Link href="/staff/vehicles" className="rounded px-2 py-1 hover:bg-muted">
            Vehicles
          </Link>
          <Link href="/staff/reminders" className="rounded px-2 py-1 hover:bg-muted">
            Reminders
          </Link>
          <Link href="/staff/settings" className="rounded px-2 py-1 hover:bg-muted">
            Settings
          </Link>
        </nav>
      </aside>
      <div className="flex-1 p-6">{children}</div>
    </div>
  );
}
