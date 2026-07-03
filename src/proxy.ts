import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { resolveTenantFromHost } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { cacheGet, cacheSet } from "@/lib/redis";

// Retired-slug lookups are cached for this long. Almost no slug is retired, so
// the cache is mostly negative hits ("" = not retired) that spare a DB query on
// every tenant navigation. updateOrgSlug invalidates the keys on a change.
const SLUG_HISTORY_TTL_SEC = 60;

// In-memory layer in front of Redis: a warm middleware isolate answers the
// slug-history check without even the Redis round-trip. Same 60s staleness
// ceiling as the Redis TTL — updateOrgSlug busts Redis immediately, and other
// isolates' memo entries age out within the window a plain TTL expiry already
// allowed. Tiny LRU (Map preserves insertion order; re-set on read).
const MEMO_TTL_MS = SLUG_HISTORY_TTL_SEC * 1000;
const MEMO_MAX = 500;
const slugMemo = new Map<string, { value: string; expires: number }>();

function memoGet(slug: string): string | null {
  const entry = slugMemo.get(slug);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    slugMemo.delete(slug);
    return null;
  }
  // Refresh recency so hot tenants stay resident.
  slugMemo.delete(slug);
  slugMemo.set(slug, entry);
  return entry.value;
}

function memoSet(slug: string, value: string) {
  if (slugMemo.size >= MEMO_MAX) {
    const oldest = slugMemo.keys().next().value;
    if (oldest !== undefined) slugMemo.delete(oldest);
  }
  slugMemo.set(slug, { value, expires: Date.now() + MEMO_TTL_MS });
}

const ROOT = process.env.ROOT_DOMAIN ?? process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localtest.me:3000";
const ROOT_HOST = ROOT.split(":")[0];
const ROOT_PORT = ROOT.includes(":") ? ROOT.split(":")[1] : "";

// If `slug` is a retired location slug, 308-redirect to the location's CURRENT
// subdomain, preserving path + query. Returns null when the slug isn't retired
// (the common case — a single indexed lookup on a small table).
async function retiredSlugRedirect(request: NextRequest, slug: string): Promise<NextResponse | null> {
  try {
    // Cache key holds the CURRENT slug if `slug` is retired, or "" if it isn't
    // (negative cache). null = cache miss → hit the DB. Empty-string reads back
    // as "" (distinct from a miss), so a "not retired" answer is cached too.
    const cacheKey = `slughist:${slug}`;
    let current = memoGet(slug);
    if (current === null) {
      current = await cacheGet<string>(cacheKey);
      if (current === null) {
        const admin = createAdminClient();
        const { data } = (await admin
          .from("org_slug_history")
          .select("organization:organizations(slug)")
          .eq("old_slug", slug)
          .maybeSingle()) as { data: { organization: { slug: string } | null } | null };
        const resolved = data?.organization?.slug ?? null;
        current = resolved && resolved !== slug ? resolved : "";
        await cacheSet(cacheKey, current, SLUG_HISTORY_TTL_SEC);
      }
      memoSet(slug, current);
    }
    if (!current) return null; // not retired
    const url = request.nextUrl.clone();
    url.hostname = `${current}.${ROOT_HOST}`;
    if (ROOT_PORT) url.port = ROOT_PORT;
    return NextResponse.redirect(url, 308);
  } catch {
    return null; // never block a request on the history lookup
  }
}

export async function proxy(request: NextRequest) {
  const start = performance.now();
  const tenant = resolveTenantFromHost(request.headers.get("host"));

  const extraHeaders: Record<string, string> = {
    "x-pathname": request.nextUrl.pathname,
  };
  if (tenant.isPlatformAdminHost) {
    // The admin host has no marketing/tenant pages — send its bare root to the
    // dashboard (which then gates through /admin/login). Everything else
    // (/admin/*, /auth/handoff, /api/*, assets) passes through untouched.
    if (request.nextUrl.pathname === "/") {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
    // Operator dashboard host — flag it for the /admin layout gate and never
    // set a tenant slug (this host is tenant-less).
    extraHeaders["x-platform-host"] = "1";
  } else if (tenant.slug) {
    // Redirect retired subdomains to their current one. Skipped for API/RSC
    // sub-requests — the top-level document navigation already redirects, and
    // those follow to the new host.
    if (!request.nextUrl.pathname.startsWith("/api/")) {
      const redirect = await retiredSlugRedirect(request, tenant.slug);
      if (redirect) return redirect;
    }
    extraHeaders["x-tenant-slug"] = tenant.slug;
  }

  const response = await updateSession(request, extraHeaders);
  // Surface middleware cost (auth verify + Redis lookups) in DevTools → Network
  // → Timing, so per-navigation latency is measurable instead of guessed.
  response.headers.set("Server-Timing", `mw;dur=${(performance.now() - start).toFixed(1)};desc="middleware"`);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
