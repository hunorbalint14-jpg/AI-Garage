import type { WeeklyHours } from "@/lib/business-hours";
import type { MiniSite, MiniSiteBranch } from "@/lib/minisite-data";

// Mini-site SEO helpers (#507 PR 3): LocalBusiness/AutoRepair structured
// data + shared URL/metadata builders. Pure — unit-tested, rendered into
// <script type="application/ld+json"> by the page.

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const minToHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function tenantBaseUrl(slug: string): string {
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "ai-garage.co.uk";
  const isLocal = rootDomain.includes("localtest") || rootDomain.includes("localhost");
  return `${isLocal ? "http" : "https"}://${slug}.${rootDomain}`;
}

// Group identical open/close pairs so Monday–Friday 8–6 is ONE spec entry —
// what Google's examples do.
export function openingHoursSpecification(weekly: WeeklyHours) {
  const groups = new Map<string, { days: string[]; opens: string; closes: string }>();
  for (let wd = 0; wd <= 6; wd++) {
    const h = weekly[wd];
    if (!h) continue;
    const key = `${h.open}-${h.close}`;
    const g = groups.get(key) ?? { days: [], opens: minToHHMM(h.open), closes: minToHHMM(h.close) };
    g.days.push(DAY_NAMES[wd]);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({
    "@type": "OpeningHoursSpecification",
    dayOfWeek: g.days,
    opens: g.opens,
    closes: g.closes,
  }));
}

export function autoRepairJsonLd(site: MiniSite, branch: MiniSiteBranch, pageUrl: string) {
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "AutoRepair",
    name: site.branches.length > 1 ? branch.name : site.org.name,
    url: pageUrl,
    image: site.org.logoUrl ?? undefined,
    telephone: site.org.phone ?? undefined,
    address: branch.address
      ? { "@type": "PostalAddress", streetAddress: branch.address, addressCountry: "GB" }
      : undefined,
    openingHoursSpecification: openingHoursSpecification(branch.weekly),
    sameAs: site.org.googleReviewUrl ? [site.org.googleReviewUrl] : undefined,
    potentialAction: {
      "@type": "ReserveAction",
      target: `${tenantBaseUrl(site.org.slug)}/book`,
      name: "Book online",
    },
  };
  // Drop undefined keys so the emitted JSON stays clean.
  return JSON.parse(JSON.stringify(ld)) as Record<string, unknown>;
}

export function siteTitle(site: MiniSite): string {
  // Last address part minus the postcode ≈ the town ("…, London NW9 5HR" → London).
  const last = site.branches[0]?.address?.split(",").pop()?.trim() ?? "";
  const town = last.replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i, "").trim();
  return `${site.org.name} — MOT, Servicing & Repairs${town ? ` in ${town}` : ""}`;
}

export function siteDescription(site: MiniSite): string {
  if (site.strapline) return site.strapline;
  const names = site.branches.flatMap((b) => b.services.map((s) => s.name));
  const top = [...new Set(names)].slice(0, 4).join(", ");
  return `${site.org.name}: ${top || "MOTs, servicing and repairs"}. Book online in under a minute.`;
}
