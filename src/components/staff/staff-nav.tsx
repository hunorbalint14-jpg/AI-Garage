"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, Bell, Settings } from "lucide-react";

const NAV_ITEMS = [
  { href: "/staff", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/staff/customers", icon: Users, label: "Customers" },
  { href: "/staff/reminders", icon: Bell, label: "Reminders" },
  { href: "/staff/settings", icon: Settings, label: "Settings" },
];

export function StaffNav() {
  const pathname = usePathname();

  return (
    <nav className="flex-1 space-y-0.5 px-3 py-4">
      {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
        const isActive =
          href === "/staff" ? pathname === "/staff" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? "bg-white/15 text-white"
                : "text-gray-400 hover:bg-white/10 hover:text-white"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
