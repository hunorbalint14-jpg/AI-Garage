import type { ReactNode } from "react";
import Link from "next/link";
import { AnimatedBackground } from "@/components/animated-background";
import type { PortalOrganization } from "@/lib/portal-auth";
import { CustomerSignOutButton } from "./sign-out-button";
import { PortalNav } from "./portal-nav";

// Branded chrome shared by the portal's top-level pages (header + animated
// background + tab nav + centred main column). Matches the look of the existing
// /dashboard page so the portal feels like one app. Detail pages that aren't a
// top-level tab (e.g. an individual invoice) keep their own back-link layout.
export function PortalShell({ org, children }: { org: PortalOrganization; children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#050c1a] text-white">
      <AnimatedBackground brandColor={org.primary_color} />

      <header className="relative z-10 border-b border-white/5 px-6 py-4 backdrop-blur-sm">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <Link href="/dashboard" className="flex items-center gap-3">
            {org.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={org.logo_url} alt={org.name} className="h-8 w-auto object-contain" />
            ) : (
              <div
                className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold text-white"
                style={{ backgroundColor: org.primary_color }}
              >
                {org.name.split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 2)}
              </div>
            )}
            <span className="text-sm font-semibold">{org.name}</span>
          </Link>
          <CustomerSignOutButton />
        </div>
      </header>

      <div className="relative z-10 mx-auto max-w-2xl px-6">
        <PortalNav orgColor={org.primary_color} />
      </div>

      <main className="relative z-10 mx-auto flex max-w-2xl flex-col gap-8 px-6 py-8">
        {children}
      </main>
    </div>
  );
}
