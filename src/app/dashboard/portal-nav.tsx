"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Shared tab bar for the logged-in customer portal. Tabs are added here as each
// destination ships — keep this list to routes that actually exist so we never
// render a link that 404s. (Quotes / Documents / Settings arrive in later
// Phase 2 PRs.)
const TABS: { href: string; label: string; exact?: boolean }[] = [
  { href: "/dashboard", label: "Overview", exact: true },
  { href: "/dashboard/history", label: "History" },
  { href: "/dashboard/quotes", label: "Quotes" },
  { href: "/dashboard/documents", label: "Documents" },
  { href: "/dashboard/settings", label: "Settings" },
];

export function PortalNav({ orgColor }: { orgColor: string }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-white/5">
      {TABS.map((t) => {
        const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              active ? "text-white" : "border-transparent text-gray-400 hover:text-white"
            }`}
            style={active ? { borderColor: orgColor } : undefined}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
