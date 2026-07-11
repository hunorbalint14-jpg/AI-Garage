import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseWeeklyHours, type SpecialHours, type WeeklyHours } from "@/lib/business-hours";

// Mini-site loader (#507 PR 2): everything the public page needs, display
// fields only, one call. Null when the org hasn't published — the tenant
// root falls back to the splash.

export type MiniSiteSectionKey = "services" | "hours" | "branches" | "reviews" | "about" | "gallery";

export type MiniSiteBranch = {
  id: string;
  slug: string;
  name: string;
  address: string | null;
  weekly: WeeklyHours;
  special: SpecialHours[];
  services: { name: string; price: number | null; category: string | null; durationMinutes: number | null }[];
};

export type MiniSite = {
  org: {
    name: string;
    slug: string;
    primaryColor: string;
    logoUrl: string | null;
    phone: string | null;
    googleReviewUrl: string | null;
  };
  strapline: string | null;
  about: string | null;
  sections: Record<MiniSiteSectionKey, boolean>;
  /** Public URLs, render order. */
  gallery: string[];
  branches: MiniSiteBranch[];
};

export function sectionsFrom(raw: unknown): Record<MiniSiteSectionKey, boolean> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const on = (k: MiniSiteSectionKey) => r[k] !== false; // absent = shown
  return {
    services: on("services"),
    hours: on("hours"),
    branches: on("branches"),
    reviews: on("reviews"),
    about: on("about"),
    gallery: on("gallery"),
  };
}

// React-cached: generateMetadata, the page, sitemap and the OG image may all
// ask within one request.
export const loadMiniSite = cache(async (organizationId: string): Promise<MiniSite | null> => {
  const admin = createAdminClient();

  const [{ data: siteRow }, { data: orgRow }] = await Promise.all([
    admin
      .from("org_sites")
      .select("published, sections, strapline, about, gallery_paths")
      .eq("organization_id", organizationId)
      .maybeSingle(),
    admin
      .from("organizations")
      .select("name, slug, primary_color, logo_url, phone, google_review_url")
      .eq("id", organizationId)
      .maybeSingle(),
  ]);
  const site = siteRow as {
    published: boolean;
    sections: unknown;
    strapline: string | null;
    about: string | null;
    gallery_paths: string[] | null;
  } | null;
  const org = orgRow as {
    name: string;
    slug: string;
    primary_color: string;
    logo_url: string | null;
    phone: string | null;
    google_review_url: string | null;
  } | null;
  if (!site?.published || !org) return null;

  const todayKey = new Date().toISOString().slice(0, 10);
  const { data: locRows } = await admin
    .from("locations")
    .select("id, slug, name, address, business_hours")
    .eq("organization_id", organizationId)
    .order("name");
  const locations = (locRows ?? []) as { id: string; slug: string; name: string; address: string | null; business_hours: unknown }[];
  const locIds = locations.map((l) => l.id);

  const [{ data: specialRows }, { data: serviceRows }] = await Promise.all([
    locIds.length
      ? admin
          .from("location_special_hours")
          .select("location_id, date, is_closed, open_minute, close_minute")
          .in("location_id", locIds)
          .gte("date", todayKey)
          .order("date")
      : Promise.resolve({ data: [] }),
    locIds.length
      ? admin
          .from("services")
          .select("location_id, name, price, category, duration_minutes")
          .in("location_id", locIds)
          .eq("active", true)
          .order("price", { ascending: true })
          .limit(200)
      : Promise.resolve({ data: [] }),
  ]);

  const specialByLoc = new Map<string, SpecialHours[]>();
  for (const s of (specialRows ?? []) as { location_id: string; date: string; is_closed: boolean; open_minute: number | null; close_minute: number | null }[]) {
    const list = specialByLoc.get(s.location_id) ?? [];
    list.push({ date: s.date, isClosed: s.is_closed, openMinute: s.open_minute, closeMinute: s.close_minute });
    specialByLoc.set(s.location_id, list);
  }
  const servicesByLoc = new Map<string, MiniSiteBranch["services"]>();
  for (const s of (serviceRows ?? []) as { location_id: string; name: string; price: number | null; category: string | null; duration_minutes: number | null }[]) {
    const list = servicesByLoc.get(s.location_id) ?? [];
    list.push({ name: s.name, price: s.price !== null ? Number(s.price) : null, category: s.category, durationMinutes: s.duration_minutes });
    servicesByLoc.set(s.location_id, list);
  }

  return {
    org: {
      name: org.name,
      slug: org.slug,
      primaryColor: org.primary_color,
      logoUrl: org.logo_url,
      phone: org.phone,
      googleReviewUrl: org.google_review_url,
    },
    strapline: site.strapline,
    about: site.about,
    sections: sectionsFrom(site.sections),
    gallery: (site.gallery_paths ?? []).map((p) => admin.storage.from("site-gallery").getPublicUrl(p).data.publicUrl),
    branches: locations.map((l) => ({
      id: l.id,
      slug: l.slug,
      name: l.name,
      address: l.address,
      weekly: parseWeeklyHours(l.business_hours),
      special: specialByLoc.get(l.id) ?? [],
      services: servicesByLoc.get(l.id) ?? [],
    })),
  };
});
