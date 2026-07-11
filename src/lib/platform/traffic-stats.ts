import type { SupabaseClient } from "@supabase/supabase-js";

// Data layer for /admin/traffic (#admin/traffic PR 2). Completed days come
// from page_view_daily rollups; today (and the whole 24h view) is aggregated
// from raw page_views, which the rollup cron keeps for 90 days. "Visitors"
// across a multi-day range is the sum of daily uniques — the visitor hash
// rotates at UTC midnight by design, so cross-day dedupe is impossible
// (that's the privacy model, not a bug).

export type TrafficRange = "24h" | "7d" | "30d" | "90d";
export type SurfaceFilter = "all" | "marketing" | "booking" | "portal" | "docs" | "staff" | "other";

export const RANGE_DAYS: Record<TrafficRange, number> = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 };

type Counts = Record<string, number>;

export type TrafficSlice = {
  bucket: string; // "2026-07-11" or hour "13:00"
  organizationId: string | null;
  surface: string;
  pageviews: number;
  visitors: number;
  devices: Counts;
  browsers: Counts;
  countries: Counts;
  cities: Counts;
  referrers: Counts;
  paths: Counts;
};

export type OrgTrafficRow = {
  id: string;
  name: string;
  slug: string;
  visitors: number;
  pageviews: number;
  bookings: number;
  /** bookings / booking-surface visitors; null when no booking traffic */
  convPct: number | null;
  spark: number[];
  /** visitors vs previous window; null when previous window empty */
  deltaPct: number | null;
};

export type TrafficStats = {
  buckets: string[];
  series: {
    visitors: { cur: number[]; prev: number[] };
    pageviews: { cur: number[]; prev: number[] };
  };
  kpis: {
    visitors: number;
    visitorsDelta: number | null;
    pageviews: number;
    pageviewsDelta: number | null;
    viewsPerVisit: number;
    viewsPerVisitPrev: number;
    activeTenants: number;
    tenantsTotal: number;
    bookings: number;
    convPct: number | null;
    convPctPrev: number | null;
  };
  orgs: OrgTrafficRow[];
  devices: [string, number][];
  browsers: [string, number][];
  oses: [string, number][];
  countries: [string, number][];
  cities: [string, number][];
  referrers: [string, number][];
  paths: [string, number][];
};

// ── pure helpers (unit-tested) ──────────────────────────────────────────────

export function addCounts(target: Counts, src: Counts | null | undefined): Counts {
  if (src) for (const [k, v] of Object.entries(src)) target[k] = (target[k] ?? 0) + Number(v);
  return target;
}

export function topEntries(counts: Counts, n: number): [string, number][] {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

export function pctDelta(cur: number, prev: number): number | null {
  if (prev <= 0) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

export function utcDayKeys(start: Date, days: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < days; i++) out.push(new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

type RawRow = {
  occurred_at: string;
  organization_id: string | null;
  surface: string;
  visitor_hash: string;
  device: string;
  browser: string;
  os: string;
  country: string | null;
  city: string | null;
  referrer_host: string | null;
  path: string;
};

// Fold raw page_views into rollup-shaped slices. bucketOf picks the grain:
// UTC day for range views, clock hour for the 24h view.
export function foldRawRows(rows: RawRow[], bucketOf: (iso: string) => string): TrafficSlice[] {
  const map = new Map<string, TrafficSlice & { hashes: Set<string> }>();
  for (const r of rows) {
    const bucket = bucketOf(r.occurred_at);
    const key = `${bucket}|${r.organization_id ?? ""}|${r.surface}`;
    let s = map.get(key);
    if (!s) {
      s = {
        bucket,
        organizationId: r.organization_id,
        surface: r.surface,
        pageviews: 0,
        visitors: 0,
        devices: {},
        browsers: {},
        countries: {},
        cities: {},
        referrers: {},
        paths: {},
        hashes: new Set(),
      };
      map.set(key, s);
    }
    s.pageviews++;
    s.hashes.add(r.visitor_hash);
    s.devices[r.device] = (s.devices[r.device] ?? 0) + 1;
    s.browsers[r.browser] = (s.browsers[r.browser] ?? 0) + 1;
    if (r.country) s.countries[r.country] = (s.countries[r.country] ?? 0) + 1;
    if (r.city) s.cities[r.city] = (s.cities[r.city] ?? 0) + 1;
    if (r.referrer_host) s.referrers[r.referrer_host] = (s.referrers[r.referrer_host] ?? 0) + 1;
    s.paths[r.path] = (s.paths[r.path] ?? 0) + 1;
  }
  return [...map.values()].map(({ hashes, ...s }) => ({ ...s, visitors: hashes.size }));
}

export function sumSeries(slices: TrafficSlice[], buckets: string[]): { visitors: number[]; pageviews: number[] } {
  const vIdx = new Map(buckets.map((b, i) => [b, i]));
  const visitors = buckets.map(() => 0);
  const pageviews = buckets.map(() => 0);
  for (const s of slices) {
    const i = vIdx.get(s.bucket);
    if (i === undefined) continue;
    visitors[i] += s.visitors;
    pageviews[i] += s.pageviews;
  }
  return { visitors, pageviews };
}

// ── fetch ───────────────────────────────────────────────────────────────────

type Admin = SupabaseClient;

type DailyDbRow = {
  day: string;
  organization_id: string | null;
  surface: string;
  pageviews: number;
  visitors: number;
  device_counts: Counts;
  browser_counts: Counts;
  country_counts: Counts;
  city_counts: Counts;
  referrer_counts: Counts;
  path_counts: Counts;
};

function sliceOfDbRow(r: DailyDbRow): TrafficSlice {
  return {
    bucket: r.day,
    organizationId: r.organization_id,
    surface: r.surface,
    pageviews: Number(r.pageviews),
    visitors: Number(r.visitors),
    devices: r.device_counts ?? {},
    browsers: r.browser_counts ?? {},
    countries: r.country_counts ?? {},
    cities: r.city_counts ?? {},
    referrers: r.referrer_counts ?? {},
    paths: r.path_counts ?? {},
  };
}

const RAW_SELECT =
  "occurred_at, organization_id, surface, visitor_hash, device, browser, os, country, city, referrer_host, path";
const RAW_LIMIT = 50_000;

export async function fetchTrafficStats(
  admin: Admin,
  range: TrafficRange,
  surface: SurfaceFilter,
): Promise<TrafficStats> {
  const now = new Date();
  const todayUtc = new Date(now);
  todayUtc.setUTCHours(0, 0, 0, 0);
  const days = RANGE_DAYS[range];

  let buckets: string[];
  let curSlices: TrafficSlice[];
  let prevSlices: TrafficSlice[];
  // os breakdown only exists in raw rows; rollups carry device+browser.
  const osCounts: Counts = {};

  if (range === "24h") {
    const curStart = new Date(now.getTime() - 24 * 3_600_000);
    const prevStart = new Date(now.getTime() - 48 * 3_600_000);
    const { data } = await admin
      .from("page_views")
      .select(RAW_SELECT)
      .gte("occurred_at", prevStart.toISOString())
      .limit(RAW_LIMIT);
    const rows = (data ?? []) as RawRow[];
    const hourOf = (iso: string) => `${String(new Date(iso).getUTCHours()).padStart(2, "0")}:00`;
    buckets = Array.from({ length: 24 }, (_, i) => hourOf(new Date(curStart.getTime() + (i + 1) * 3_600_000).toISOString()));
    const curRows = rows.filter((r) => r.occurred_at >= curStart.toISOString());
    const prevRows = rows.filter((r) => r.occurred_at < curStart.toISOString());
    curSlices = foldRawRows(curRows, hourOf);
    prevSlices = foldRawRows(prevRows, hourOf);
    for (const r of curRows) if (surfaceMatch(r.surface, surface)) osCounts[r.os] = (osCounts[r.os] ?? 0) + 1;
  } else {
    // Completed days from rollups (cur + prev windows in one query)…
    const curStart = new Date(todayUtc.getTime() - (days - 1) * 86_400_000);
    const prevStart = new Date(curStart.getTime() - days * 86_400_000);
    buckets = utcDayKeys(curStart, days); // last bucket = today, filled from raw
    const [rollupRes, rawRes] = await Promise.all([
      admin
        .from("page_view_daily")
        .select(
          "day, organization_id, surface, pageviews, visitors, device_counts, browser_counts, country_counts, city_counts, referrer_counts, path_counts",
        )
        .gte("day", prevStart.toISOString().slice(0, 10))
        .limit(RAW_LIMIT),
      // …today's partial (and yesterday/-2d not yet rolled) from raw.
      admin
        .from("page_views")
        .select(RAW_SELECT)
        .gte("occurred_at", new Date(todayUtc.getTime() - 2 * 86_400_000).toISOString())
        .limit(RAW_LIMIT),
    ]);
    const rollups = ((rollupRes.data ?? []) as DailyDbRow[]).map(sliceOfDbRow);
    const rolledDays = new Set(rollups.map((s) => s.bucket));
    const dayOf = (iso: string) => iso.slice(0, 10);
    const rawRows = ((rawRes.data ?? []) as RawRow[]).filter((r) => !rolledDays.has(dayOf(r.occurred_at)));
    const rawSlices = foldRawRows(rawRows, dayOf);
    const curKey = buckets[0];
    const all = [...rollups, ...rawSlices];
    curSlices = all.filter((s) => s.bucket >= curKey);
    prevSlices = all.filter((s) => s.bucket < curKey);
    for (const r of rawRows) if (r.occurred_at >= curKey && surfaceMatch(r.surface, surface)) osCounts[r.os] = (osCounts[r.os] ?? 0) + 1;
  }

  const cur = curSlices.filter((s) => surfaceMatch(s.surface, surface));
  const prev = prevSlices.filter((s) => surfaceMatch(s.surface, surface));

  // Series. The prev window gets its own explicit bucket axis (same length),
  // so position i compares like-for-like: i days into each window, or the
  // same clock hour a day earlier for the 24h view.
  const curSeries = sumSeries(cur, buckets);
  const prevBucketAxis =
    range === "24h"
      ? buckets // hour labels repeat across days; prev slices were folded separately
      : utcDayKeys(new Date(new Date(`${buckets[0]}T00:00:00Z`).getTime() - days * 86_400_000), days);
  const prevSeries = sumSeries(prev, prevBucketAxis);

  // Panels.
  const devices: Counts = {}, browsers: Counts = {}, countries: Counts = {}, cities: Counts = {}, referrers: Counts = {}, paths: Counts = {};
  for (const s of cur) {
    addCounts(devices, s.devices);
    addCounts(browsers, s.browsers);
    addCounts(countries, s.countries);
    addCounts(cities, s.cities);
    addCounts(referrers, s.referrers);
    addCounts(paths, s.paths);
  }

  // Org table + bookings for conversion.
  const windowStartIso =
    range === "24h" ? new Date(now.getTime() - 24 * 3_600_000).toISOString() : `${buckets[0]}T00:00:00Z`;
  const prevWindowStartIso =
    range === "24h"
      ? new Date(now.getTime() - 48 * 3_600_000).toISOString()
      : new Date(new Date(`${buckets[0]}T00:00:00Z`).getTime() - days * 86_400_000).toISOString();

  const [orgsRes, locsRes, bookingsRes] = await Promise.all([
    admin.from("organizations").select("id, name, slug"),
    admin.from("locations").select("id, organization_id"),
    admin.from("bookings").select("location_id, created_at").gte("created_at", prevWindowStartIso).limit(RAW_LIMIT),
  ]);
  const orgMeta = new Map(((orgsRes.data ?? []) as { id: string; name: string; slug: string }[]).map((o) => [o.id, o]));
  const locOrg = new Map(((locsRes.data ?? []) as { id: string; organization_id: string }[]).map((l) => [l.id, l.organization_id]));

  const bookingsByOrg: Counts = {};
  let bookingsTotal = 0;
  let bookingsPrevTotal = 0;
  for (const b of (bookingsRes.data ?? []) as { location_id: string; created_at: string }[]) {
    const orgId = locOrg.get(b.location_id);
    if (!orgId) continue;
    if (b.created_at >= windowStartIso) {
      bookingsByOrg[orgId] = (bookingsByOrg[orgId] ?? 0) + 1;
      bookingsTotal++;
    } else {
      bookingsPrevTotal++;
    }
  }

  type OrgAgg = { visitors: number; pageviews: number; bookingVisitors: number; byBucket: Counts };
  const orgAgg = new Map<string, OrgAgg>();
  const orgPrevVisitors: Counts = {};
  for (const s of cur) {
    if (!s.organizationId) continue;
    let a = orgAgg.get(s.organizationId);
    if (!a) {
      a = { visitors: 0, pageviews: 0, bookingVisitors: 0, byBucket: {} };
      orgAgg.set(s.organizationId, a);
    }
    a.visitors += s.visitors;
    a.pageviews += s.pageviews;
    a.byBucket[s.bucket] = (a.byBucket[s.bucket] ?? 0) + s.visitors;
  }
  // Conversion denominator is always booking-surface visitors, regardless of
  // the active surface filter — the metric means "of people who saw the
  // booking flow, how many booked".
  for (const s of curSlices) {
    if (!s.organizationId || s.surface !== "booking") continue;
    const a = orgAgg.get(s.organizationId);
    if (a) a.bookingVisitors += s.visitors;
  }
  for (const s of prev) if (s.organizationId) orgPrevVisitors[s.organizationId] = (orgPrevVisitors[s.organizationId] ?? 0) + s.visitors;

  const orgs: OrgTrafficRow[] = [...orgAgg.entries()]
    .map(([id, a]) => {
      const meta = orgMeta.get(id);
      const bookings = bookingsByOrg[id] ?? 0;
      return {
        id,
        name: meta?.name ?? "(deleted org)",
        slug: meta?.slug ?? "—",
        visitors: a.visitors,
        pageviews: a.pageviews,
        bookings,
        convPct: a.bookingVisitors > 0 ? Math.round((bookings / a.bookingVisitors) * 1000) / 10 : null,
        spark: buckets.map((b) => a.byBucket[b] ?? 0),
        deltaPct: pctDelta(a.visitors, orgPrevVisitors[id] ?? 0),
      };
    })
    .sort((a, b) => b.visitors - a.visitors);

  const visitors = curSeries.visitors.reduce((s, v) => s + v, 0);
  const pageviews = curSeries.pageviews.reduce((s, v) => s + v, 0);
  const visitorsPrev = prevSeries.visitors.reduce((s, v) => s + v, 0);
  const pageviewsPrev = prevSeries.pageviews.reduce((s, v) => s + v, 0);
  const bookingVisitorsAll = curSlices.filter((s) => s.surface === "booking").reduce((s, x) => s + x.visitors, 0);
  const bookingVisitorsPrevAll = prevSlices.filter((s) => s.surface === "booking").reduce((s, x) => s + x.visitors, 0);

  return {
    buckets,
    series: {
      visitors: { cur: curSeries.visitors, prev: prevSeries.visitors },
      pageviews: { cur: curSeries.pageviews, prev: prevSeries.pageviews },
    },
    kpis: {
      visitors,
      visitorsDelta: pctDelta(visitors, visitorsPrev),
      pageviews,
      pageviewsDelta: pctDelta(pageviews, pageviewsPrev),
      viewsPerVisit: visitors > 0 ? Math.round((pageviews / visitors) * 10) / 10 : 0,
      viewsPerVisitPrev: visitorsPrev > 0 ? Math.round((pageviewsPrev / visitorsPrev) * 10) / 10 : 0,
      activeTenants: orgAgg.size,
      tenantsTotal: orgMeta.size,
      bookings: bookingsTotal,
      convPct: bookingVisitorsAll > 0 ? Math.round((bookingsTotal / bookingVisitorsAll) * 1000) / 10 : null,
      convPctPrev: bookingVisitorsPrevAll > 0 ? Math.round((bookingsPrevTotal / bookingVisitorsPrevAll) * 1000) / 10 : null,
    },
    orgs,
    devices: topEntries(devices, 6),
    browsers: topEntries(browsers, 8),
    oses: topEntries(osCounts, 8),
    countries: topEntries(countries, 10),
    cities: topEntries(cities, 10),
    referrers: topEntries(referrers, 10),
    paths: topEntries(paths, 10),
  };
}

function surfaceMatch(s: string, filter: SurfaceFilter): boolean {
  return filter === "all" || s === filter;
}

