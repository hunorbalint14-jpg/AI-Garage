import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

// Cached per-location reference reads: services, products, bays, opening
// hours. These change rarely (a settings edit, a stock receipt) but were
// fetched from Postgres on every navigation that renders a picker, the day
// schedule, or the booking widget. Same recipe as listLocationStaff
// (src/lib/staff-directory.ts): admin client inside, args-only (no
// cookies/headers), 60s time revalidate as the safety net, plus a tag per
// entity so mutations bust immediately via revalidateLocationCache().
//
// Column supersets cover every current call site; callers narrow the shape.

export type CachedService = {
  id: string;
  name: string;
  category: string | null;
  duration_minutes: number;
  price: number | null;
  /** True (default) = price is gross / VAT-inclusive. See src/lib/vat.ts. */
  vat_included: boolean;
};

export type CachedProduct = {
  id: string;
  name: string;
  unit_price: number;
  cost_price: number | null;
  category: string | null;
};

export type CachedBay = {
  id: string;
  name: string;
  description: string | null;
};

export type CachedSpecialHours = {
  location_id: string;
  date: string;
  is_closed: boolean;
  open_minute: number | null;
  close_minute: number | null;
};

export type CachedHours = {
  /** Raw locations.business_hours jsonb — parse with parseWeeklyHours(). */
  weekly: unknown;
  /** Overrides on/after the todayKey the cache entry was keyed with. */
  special: CachedSpecialHours[];
};

const REVALIDATE_SECONDS = 60;

export const locationCacheTag = (
  kind: "services" | "products" | "bays" | "hours",
  locationId: string,
) => `location-${kind}:${locationId}`;

/** Active services for the pickers + booking widget (ordered category, name). */
export async function cachedActiveServices(locationId: string): Promise<CachedService[]> {
  return unstable_cache(
    async () => {
      const admin = createAdminClient();
      const { data } = await admin
        .from("services")
        .select("id, name, category, duration_minutes, price, vat_included")
        .eq("location_id", locationId)
        .eq("active", true)
        .order("category")
        .order("name");
      return (data ?? []) as CachedService[];
    },
    ["location-services", locationId],
    { revalidate: REVALIDATE_SECONDS, tags: [locationCacheTag("services", locationId)] },
  )();
}

/** Active products for the quote/job item pickers (ordered by name). */
export async function cachedActiveProducts(locationId: string): Promise<CachedProduct[]> {
  return unstable_cache(
    async () => {
      const admin = createAdminClient();
      const { data } = await admin
        .from("products")
        .select("id, name, unit_price, cost_price, category")
        .eq("location_id", locationId)
        .eq("active", true)
        .order("name");
      return (data ?? []) as CachedProduct[];
    },
    ["location-products", locationId],
    { revalidate: REVALIDATE_SECONDS, tags: [locationCacheTag("products", locationId)] },
  )();
}

/** Workshop bays in display order (sort_order, then created_at). */
export async function cachedBays(locationId: string): Promise<CachedBay[]> {
  return unstable_cache(
    async () => {
      const admin = createAdminClient();
      const { data } = await admin
        .from("bays")
        .select("id, name, description")
        .eq("location_id", locationId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      return (data ?? []) as CachedBay[];
    },
    ["location-bays", locationId],
    { revalidate: REVALIDATE_SECONDS, tags: [locationCacheTag("bays", locationId)] },
  )();
}

/**
 * Weekly opening hours (raw jsonb) + special-date overrides from `todayKey`
 * onwards. todayKey (local YYYY-MM-DD) is part of the cache key, so the
 * upcoming-overrides window rolls over cleanly at midnight.
 */
export async function cachedLocationHours(
  locationId: string,
  todayKey: string,
): Promise<CachedHours> {
  return unstable_cache(
    async () => {
      const admin = createAdminClient();
      const [{ data: locRow }, { data: specialRows }] = await Promise.all([
        admin.from("locations").select("business_hours").eq("id", locationId).maybeSingle(),
        admin
          .from("location_special_hours")
          .select("location_id, date, is_closed, open_minute, close_minute")
          .eq("location_id", locationId)
          .gte("date", todayKey)
          .order("date"),
      ]);
      return {
        weekly: (locRow as { business_hours?: unknown } | null)?.business_hours ?? null,
        special: (specialRows ?? []) as CachedSpecialHours[],
      };
    },
    ["location-hours", locationId, todayKey],
    { revalidate: REVALIDATE_SECONDS, tags: [locationCacheTag("hours", locationId)] },
  )();
}
