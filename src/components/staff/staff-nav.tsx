"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, Bell, Settings, Megaphone, CalendarDays, Receipt, TrendingUp, Building2, Wrench, Columns, UserCog, FlaskConical, Zap, Package } from "lucide-react";
import type { PortalTheme } from "@/lib/portal-themes";
import { PORTAL_THEMES } from "@/lib/portal-themes";

const BASE_NAV = [
  { href: "/staff", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/staff/customers", icon: Users, label: "Customers" },
  { href: "/staff/bookings", icon: CalendarDays, label: "Bookings" },
  { href: "/staff/fleet", icon: Building2, label: "Fleet" },
  { href: "/staff/invoices", icon: Receipt, label: "Invoices" },
  { href: "/staff/reminders", icon: Bell, label: "Reminders" },
  { href: "/staff/settings", icon: Settings, label: "Settings" },
];

const OWNER_NAV = [
  { href: "/staff/revenue", icon: TrendingUp, label: "Revenue" },
  { href: "/staff/services", icon: Wrench, label: "Services" },
  { href: "/staff/products", icon: Package, label: "Products" },
  { href: "/staff/bays", icon: Columns, label: "Bays" },
  { href: "/staff/campaigns", icon: Megaphone, label: "Campaigns" },
  { href: "/staff/automations", icon: Zap, label: "Automations" },
  { href: "/staff/staff-members", icon: UserCog, label: "Team" },
  { href: "/staff/dev", icon: FlaskConical, label: "Dev tools" },
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

  if (theme === "workshop") {
    const onBrand = (() => {
      try {
        const h = brandColor.replace("#", "");
        const r = parseInt(h.slice(0, 2), 16);
        const g = parseInt(h.slice(2, 4), 16);
        const b = parseInt(h.slice(4, 6), 16);
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.45 ? "#0e1014" : "#e6e8eb";
      } catch { return "#0e1014"; }
    })();

    return (
      <nav className="flex-1 flex flex-col py-3">
        <p className="px-4 pb-2 font-mono text-[10px] text-[#5a6170] tracking-[0.18em]">// SHOP</p>
        {navItems.map(({ href, icon: Icon, label }, i) => {
          const isActive =
            href === "/staff" ? pathname === "/staff" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-[7px] text-sm font-medium transition-colors border-l-[3px] ${
                isActive
                  ? "font-bold"
                  : "text-[#9aa1ad] border-transparent hover:bg-[#1c2026] hover:text-[#e6e8eb]"
              }`}
              style={isActive ? {
                backgroundColor: brandColor,
                color: onBrand,
                borderLeftColor: brandColor,
              } : undefined}
            >
              <span className="font-mono text-[10px] w-5 shrink-0 opacity-50 tabular-nums">
                {String(i + 1).padStart(2, "0")}
              </span>
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>
    );
  }

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
