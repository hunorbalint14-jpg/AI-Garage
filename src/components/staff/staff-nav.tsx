"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, Bell, Settings } from "lucide-react";
import type { PortalTheme } from "@/lib/portal-themes";
import { PORTAL_THEMES } from "@/lib/portal-themes";

const NAV_ITEMS = [
  { href: "/staff", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/staff/customers", icon: Users, label: "Customers" },
  { href: "/staff/reminders", icon: Bell, label: "Reminders" },
  { href: "/staff/settings", icon: Settings, label: "Settings" },
];

export function StaffNav({
  theme = "dark",
  brandColor = "#6366f1",
}: {
  theme?: PortalTheme;
  brandColor?: string;
}) {
  const pathname = usePathname();
  const cfg = PORTAL_THEMES[theme];

  return (
    <nav className="flex-1 space-y-0.5 px-3 py-4">
      {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
        const isActive =
          href === "/staff" ? pathname === "/staff" : pathname.startsWith(href);

        const activeStyle =
          (theme === "light" || theme === "glass") && isActive
            ? { backgroundColor: brandColor }
            : undefined;

        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              isActive ? cfg.navActive : cfg.navInactive
            }`}
            style={activeStyle}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
