"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, Bell, Settings, Megaphone } from "lucide-react";
import type { PortalTheme } from "@/lib/portal-themes";
import { PORTAL_THEMES } from "@/lib/portal-themes";

const BASE_NAV = [
  { href: "/staff", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/staff/customers", icon: Users, label: "Customers" },
  { href: "/staff/reminders", icon: Bell, label: "Reminders" },
  { href: "/staff/settings", icon: Settings, label: "Settings" },
];

const OWNER_NAV = [
  { href: "/staff/campaigns", icon: Megaphone, label: "Campaigns" },
];

export function StaffNav({
  theme = "dark",
  brandColor = "#6366f1",
  orgRole,
}: {
  theme?: PortalTheme;
  brandColor?: string;
  orgRole?: "owner" | "admin" | null;
}) {
  const pathname = usePathname();
  const cfg = PORTAL_THEMES[theme];

  const navItems = [
    ...BASE_NAV,
    ...(orgRole ? OWNER_NAV : []),
  ];

  return (
    <nav className="flex-1 space-y-0.5 px-3 py-4">
      {navItems.map(({ href, icon: Icon, label }) => {
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
