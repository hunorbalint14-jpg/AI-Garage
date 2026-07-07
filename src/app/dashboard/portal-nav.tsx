"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { TrackedLink as Link } from "@/components/nav-progress";

// Shared tab bar for the logged-in customer portal. Four tabs fit a 390px
// viewport without scrolling (UX review F14). Quotes and Plans stay routable —
// pending quotes surface on Overview as Next-up/action cards, and the quotes
// list is linked from Documents.
const TABS: { href: string; label: string; exact?: boolean }[] = [
  { href: "/dashboard", label: "Overview", exact: true },
  { href: "/dashboard/history", label: "History" },
  { href: "/dashboard/documents", label: "Documents" },
  { href: "/dashboard/settings", label: "Settings" },
];

export function PortalNav({ orgColor }: { orgColor: string }) {
  const pathname = usePathname();
  const scroller = useRef<HTMLElement>(null);
  // The scrollbar is hidden, so on narrow screens nothing hints that Plans /
  // Settings sit past the edge — fade the right edge while there's more to
  // scroll to.
  const [overflowRight, setOverflowRight] = useState(false);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => setOverflowRight(el.scrollWidth - el.clientWidth - el.scrollLeft > 8);
    const raf = requestAnimationFrame(update);
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div className="relative">
      <nav
        ref={scroller}
        className="flex gap-1 overflow-x-auto border-b border-white/5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {TABS.map((t) => {
          const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors sm:px-4 ${
                active ? "text-white" : "border-transparent text-gray-400 hover:text-white"
              }`}
              style={active ? { borderColor: orgColor } : undefined}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-[#0b0d11] to-transparent transition-opacity duration-200 ${
          overflowRight ? "opacity-100" : "opacity-0"
        }`}
      />
    </div>
  );
}
