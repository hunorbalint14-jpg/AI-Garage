"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Sidebar nav. Active state is computed client-side from usePathname() — the
// /admin layout is a server component that does NOT re-render on client-side
// navigation between admin pages, so a server-derived active state (from the
// x-pathname header) would freeze on the first-loaded route.
const NAV: { href: string; label: string; match: (p: string) => boolean }[] = [
  { href: "/admin", label: "Overview", match: (p) => p === "/admin" || p.startsWith("/admin/orgs") },
  { href: "/admin/ai", label: "AI usage", match: (p) => p.startsWith("/admin/ai") },
  { href: "/admin/health", label: "Reliability", match: (p) => p.startsWith("/admin/health") },
  { href: "/admin/incidents", label: "Incidents", match: (p) => p.startsWith("/admin/incidents") },
  { href: "/admin/admins", label: "Admins", match: (p) => p.startsWith("/admin/admins") },
];

export function AdminNav({ activeIncidents }: { activeIncidents: number }) {
  const pathname = usePathname() ?? "";
  return (
    <nav className="mt-1 flex flex-col gap-0.5">
      {NAV.map((item) => {
        const active = item.match(pathname);
        const badge = item.href === "/admin/incidents" && activeIncidents > 0 ? activeIncidents : 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`relative flex items-center justify-between gap-2 rounded-[7px] px-2.5 py-2 text-[13px] font-medium transition-colors ${
              active
                ? "bg-white/[0.05] text-white shadow-[inset_2px_0_0_#22c55e]"
                : "text-[#9aa1ad] hover:bg-white/[0.03] hover:text-white"
            }`}
          >
            {item.label}
            {badge > 0 && (
              <span className="rounded-[10px] border border-[#5a2424] bg-[#3a1a1a] px-1.5 font-mono text-[10px] font-semibold text-[#ff7b7b]">
                {badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
