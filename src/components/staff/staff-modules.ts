// Route → module grouping for the staff dock.
// Edit this file to re-organise the nav. The shell auto-filters items based
// on the user's permissions (org owner/admin bypass everything), and hides
// any module that ends up empty.

import {
  LayoutDashboard, Users, Bell, Settings, Megaphone, CalendarDays, Receipt,
  TrendingUp, Building2, Wrench, Columns, UserCog, FlaskConical, Zap, Package,
  Share2, FileText, ShieldCheck, Truck, ClipboardList, BarChart3, Repeat, CreditCard,
  Hammer, RotateCcw, PhoneCall, CarFront,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { PermissionKey } from "@/app/staff/staff-members/constants";

export type NavItem = {
  key: string;
  href: string;
  label: string;
  icon: LucideIcon;
  /** Hide unless the user has this permission (or is org owner/admin). */
  permission?: PermissionKey;
  /** Hide unless the user is org owner or admin (used for surfaces that are not gated by a single permission). */
  adminOnly?: boolean;
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
      { key: "bookings",  href: "/staff/bookings",   label: "Bookings",  icon: CalendarDays, permission: "bookings" },
      { key: "jobs",      href: "/staff/jobs",       label: "Jobs",      icon: Hammer,       permission: "bookings" },
      { key: "customers", href: "/staff/customers",  label: "Customers", icon: Users,        permission: "customers" },
      { key: "fleet",     href: "/staff/fleet",      label: "Fleet",     icon: Building2,    permission: "fleet" },
      { key: "reminders", href: "/staff/reminders",  label: "Reminders", icon: Bell,         permission: "reminders" },
      { key: "courtesy-cars", href: "/staff/courtesy-cars", label: "Courtesy cars", icon: CarFront, permission: "bookings" },
    ],
  },
  {
    key: "shop",
    label: "Shop",
    icon: Wrench,
    items: [
      { key: "services",  href: "/staff/services",  label: "Services",  icon: Wrench,         permission: "services" },
      { key: "products",  href: "/staff/products",  label: "Products",  icon: Package,        permission: "products" },
      { key: "suppliers", href: "/staff/suppliers", label: "Suppliers", icon: Truck,          permission: "products" },
      { key: "purchase-orders", href: "/staff/purchase-orders", label: "Purchase orders", icon: ClipboardList, permission: "products" },
      { key: "bays",      href: "/staff/bays",      label: "Bays",      icon: Columns,        permission: "bays" },
    ],
  },
  {
    key: "money",
    label: "Money",
    icon: TrendingUp,
    items: [
      { key: "revenue",  href: "/staff/revenue",  label: "Revenue",  icon: TrendingUp, permission: "revenue" },
      { key: "quotes",   href: "/staff/quotes",   label: "Quotes",   icon: FileText,   permission: "quotes_draft" },
      { key: "invoices", href: "/staff/invoices", label: "Invoices", icon: Receipt,    permission: "invoices" },
      { key: "plans",    href: "/staff/plans",    label: "Plans",    icon: Repeat,     permission: "services" },
      { key: "reports",  href: "/staff/reports",  label: "Reports",  icon: BarChart3,  permission: "reports" },
    ],
  },
  {
    key: "grow",
    label: "Grow",
    icon: Megaphone,
    items: [
      { key: "campaigns",   href: "/staff/campaigns",   label: "Campaigns",   icon: Megaphone, permission: "campaigns" },
      { key: "win-back",    href: "/staff/win-back",    label: "Win-back",    icon: RotateCcw, permission: "campaigns" },
      { key: "receptionist", href: "/staff/receptionist", label: "Receptionist", icon: PhoneCall, permission: "bookings" },
      { key: "automations", href: "/staff/automations", label: "Automations", icon: Zap,       permission: "automations" },
    ],
  },
  {
    key: "admin",
    label: "Admin",
    icon: Settings,
    items: [
      { key: "team",     href: "/staff/staff-members", label: "Team",       icon: UserCog,      permission: "staff_manage" },
      { key: "settings", href: "/staff/settings",     label: "Settings",   icon: Settings },
      { key: "billing",  href: "/staff/settings/billing", label: "Billing", icon: CreditCard, adminOnly: true },
      { key: "audit",    href: "/staff/audit-log",    label: "Audit log",  icon: ShieldCheck,  permission: "audit_log" },
      { key: "docs",     href: "/staff/docs",         label: "Doc shares", icon: Share2,       adminOnly: true },
      { key: "dev",      href: "/staff/dev",          label: "Dev tools",  icon: FlaskConical, adminOnly: true },
    ],
  },
];

type FilterCtx = {
  orgRole: "owner" | "admin" | null | undefined;
  locationPermissions?: Partial<Record<PermissionKey, boolean>> | null;
};

export function filterModulesForRole(ctxOrOrgRole: FilterCtx | "owner" | "admin" | null | undefined): NavModule[] {
  // Back-compat: also accept the old (orgRole) call signature.
  const ctx: FilterCtx =
    typeof ctxOrOrgRole === "object" && ctxOrOrgRole !== null
      ? ctxOrOrgRole
      : { orgRole: ctxOrOrgRole ?? null, locationPermissions: null };

  const isOwnerOrAdmin = ctx.orgRole === "owner" || ctx.orgRole === "admin";

  const itemAllowed = (i: NavItem): boolean => {
    if (i.adminOnly && !isOwnerOrAdmin) return false;
    if (i.permission && !isOwnerOrAdmin) {
      return ctx.locationPermissions?.[i.permission] === true;
    }
    return true;
  };

  return NAV_MODULES
    .map((m) => ({ ...m, items: m.items.filter(itemAllowed) }))
    .filter((m) => m.items.length > 0);
}

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
