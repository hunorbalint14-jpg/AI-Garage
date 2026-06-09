"use client";

import { usePathname } from "next/navigation";
import { AutoRefresh } from "@/components/admin/auto-refresh";

// Topbar title + refresh. Like the nav, the title is derived client-side from
// usePathname() so it updates on client-side navigation (the server layout
// doesn't re-render between admin pages). The sign-out form (server action) is
// passed in as children from the server layout.
function pageTitleFor(pathname: string): string {
  if (pathname === "/admin") return "Platform overview";
  if (pathname.startsWith("/admin/orgs")) return "Organisation";
  if (pathname.startsWith("/admin/ai")) return "AI usage";
  if (pathname.startsWith("/admin/health")) return "Platform reliability";
  if (pathname.startsWith("/admin/incidents")) return "Incidents";
  if (pathname.startsWith("/admin/admins")) return "Platform admins";
  return "Platform";
}

export function AdminTopbar({
  statusUrl,
  statusDot,
  children,
}: {
  statusUrl: string;
  statusDot: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const title = pageTitleFor(pathname);
  // Live data pages get the auto-refresh indicator; the admins page (forms) does not.
  const liveRefresh = !pathname.startsWith("/admin/admins");

  return (
    <header className="flex items-center justify-between gap-4 border-b border-[#23272f] bg-[#15181d] px-[18px] py-3">
      <h1 className="truncate text-[18px] font-semibold tracking-tight">{title}</h1>
      <div className="flex items-center gap-3">
        {liveRefresh && <AutoRefresh />}
        <a
          href={statusUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="hidden items-center gap-2 rounded-lg border border-[#2a2f37] bg-[#171b21] px-2.5 py-1.5 text-[12px] font-semibold text-[#c7ccd4] transition-colors hover:border-[#343b45] hover:text-white sm:flex"
        >
          <span className={`h-2 w-2 rounded-full ${statusDot}`} />
          Status<span className="text-[11px] text-[#5a6170]">↗</span>
        </a>
        {children}
      </div>
    </header>
  );
}
