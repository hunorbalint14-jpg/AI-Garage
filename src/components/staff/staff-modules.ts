// Route → module grouping for the staff dock.
// Edit this file to re-organise the nav. The shell auto-filters owner-only
// items based on `orgRole`, and hides any module that ends up empty.

import {
  LayoutDashboard, Users, Bell, Settings, Megaphone, CalendarDays, Receipt,
  TrendingUp, Building2, Wrench, Columns, UserCog, FlaskConical, Zap, Package,
  Share2, FileText, ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavItem = {
  key: string;
  href: string;
  label: string;
  icon: LucideIcon;
  /** Hide for location-level staff; show only when orgRole is set */
  ownerOnly?: boolean;
};

export type NavModule = {
  key: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
};

export const NAV_MODULES: NavModule[] = [
  {
    key: "ops",
    label: "Ops",
    icon: CalendarDays,
    items: [
      { key: "dashboard", href: "/staff",            label: "Dashboard", icon: LayoutDashboard },
      { key: "bookings",  href: "/staff/bookings",   label: "Bookings",  icon: CalendarDays },
      { key: "customers", href: "/staff/customers",  label: "Customers", icon: Users },
      { key: "fleet",     href: "/staff/fleet",      label: "Fleet",     icon: Building2 },
      { key: "reminders", href: "/staff/reminders",  label: "Reminders", icon: Bell },
    ],
  },
  {
    key: "shop",
    label: "Shop",
    icon: Wrench,
    items: [
      { key: "services", href: "/staff/services", label: "Services", icon: Wrench,  ownerOnly: true },
      { key: "products", href: "/staff/products", label: "Products", icon: Package, ownerOnly: true },
      { key: "bays",     href: "/staff/bays",     label: "Bays",     icon: Columns, ownerOnly: true },
    ],
  },
  {
    key: "money",
    label: "Money",
    icon: TrendingUp,
    items: [
      { key: "revenue",  href: "/staff/revenue",  label: "Revenue",  icon: TrendingUp, ownerOnly: true },
      { key: "quotes",   href: "/staff/quotes",   label: "Quotes",   icon: FileText },
      { key: "invoices", href: "/staff/invoices", label: "Invoices", icon: Receipt },
    ],
  },
  {
    key: "grow",
    label: "Grow",
    icon: Megaphone,
    items: [
      { key: "campaigns",   href: "/staff/campaigns",   label: "Campaigns",   icon: Megaphone, ownerOnly: true },
      { key: "automations", href: "/staff/automations", label: "Automations", icon: Zap,       ownerOnly: true },
    ],
  },
  {
    key: "admin",
    label: "Admin",
    icon: Settings,
    items: [
      { key: "team",     href: "/staff/staff-members", label: "Team",       icon: UserCog,      ownerOnly: true },
      { key: "settings", href: "/staff/settings",     label: "Settings",   icon: Settings },
      { key: "audit",    href: "/staff/audit-log",    label: "Audit log",  icon: ShieldCheck,  ownerOnly: true },
      { key: "docs",     href: "/staff/docs",         label: "Doc shares", icon: Share2,       ownerOnly: true },
      { key: "dev",      href: "/staff/dev",          label: "Dev tools",  icon: FlaskConical, ownerOnly: true },
    ],
  },
];

export function filterModulesForRole(
  orgRole: "owner" | "admin" | null | undefined,
): NavModule[] {
  const isOwnerOrAdmin = !!orgRole;
  return NAV_MODULES
    .map((m) => ({ ...m, items: m.items.filter((i) => !i.ownerOnly || isOwnerOrAdmin) }))
    .filter((m) => m.items.length > 0);
}

/**
 * Given a pathname, work out which module + item is currently active.
 * Picks the longest matching href so /staff/bookings/123 still maps to Bookings.
 */
export function findActive(
  pathname: string,
  modules: NavModule[],
): { module: NavModule; item: NavItem } {
  let best: { module: NavModule; item: NavItem; score: number } | null = null;
  for (const m of modules) {
    for (const item of m.items) {
      const matches =
        item.href === "/staff"
          ? pathname === "/staff"
          : pathname === item.href || pathname.startsWith(item.href + "/");
      if (matches && (best === null || item.href.length > best.score)) {
        best = { module: m, item, score: item.href.length };
      }
    }
  }
  if (best) return { module: best.module, item: best.item };
  return { module: modules[0], item: modules[0].items[0] };
}

/** Black text on light brand colors, white on dark. Mirrors layout.tsx helper. */
export function onBrandColor(brandHex: string): string {
  try {
    const h = brandHex.replace("#", "");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.45 ? "#0e1014" : "#e6e8eb";
  } catch {
    return "#0e1014";
  }
}
