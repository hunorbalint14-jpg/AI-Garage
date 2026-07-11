import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTenantFromHost } from "@/lib/tenant";
import {
  visitorHash,
  utcDayString,
  normalizePath,
  classifySurface,
  referrerHost,
  parseUserAgent,
  geoFromHeaders,
} from "@/lib/traffic";

export const runtime = "nodejs";

// Page-view collector (#admin/traffic PR 1). Receives the TrackPageview beacon,
// derives everything privacy-sensitive server-side, inserts one page_views row.
// Always answers 204 — analytics must never break or signal anything to the
// visitor, so parse failures and DB errors are swallowed (logged server-side).

// slug → organization_id memo. Tenant slugs are stable (renames flow through
// org_slug_history + a 308 before reaching us), so a warm isolate skips the
// lookup; entries age out so a deleted org stops resolving within the hour.
const ORG_TTL_MS = 60 * 60 * 1000;
const orgMemo = new Map<string, { id: string | null; expires: number }>();

async function orgIdForSlug(slug: string): Promise<string | null> {
  const hit = orgMemo.get(slug);
  if (hit && Date.now() < hit.expires) return hit.id;
  const admin = createAdminClient();
  const { data } = await admin.from("organizations").select("id").eq("slug", slug).maybeSingle();
  const id = (data as { id: string } | null)?.id ?? null;
  if (orgMemo.size > 500) orgMemo.clear();
  orgMemo.set(slug, { id, expires: Date.now() + ORG_TTL_MS });
  return id;
}

// A Response body can only be consumed once — mint a fresh 204 per return.
const noContent = () => new NextResponse(null, { status: 204 });

export async function POST(request: NextRequest) {
  try {
    const host = request.headers.get("host");
    const tenant = resolveTenantFromHost(host);
    // Operator dashboard traffic is not product analytics.
    if (tenant.isPlatformAdminHost) return noContent();

    const ua = parseUserAgent(request.headers.get("user-agent"));
    if (ua.isBot) return noContent();

    // sendBeacon posts an opaque text/plain body — parse by hand.
    let body: { path?: unknown; ref?: unknown };
    try {
      body = JSON.parse(await request.text());
    } catch {
      return noContent();
    }
    if (typeof body.path !== "string" || body.path.length === 0 || body.path.length > 2000) return noContent();

    const path = normalizePath(body.path);
    const surface = classifySurface(path);

    const secret = process.env.APP_ENCRYPTION_KEY;
    if (!secret) return noContent(); // collection is optional infra — never 500

    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "0.0.0.0";
    const geo = geoFromHeaders((n) => request.headers.get(n));

    const organizationId = tenant.slug ? await orgIdForSlug(tenant.slug) : null;
    // Unknown subdomain (stale link, probe) — nothing to attribute, skip.
    if (tenant.slug && !organizationId) return noContent();

    const admin = createAdminClient();
    const { error } = await admin.from("page_views").insert({
      organization_id: organizationId,
      surface,
      path,
      visitor_hash: visitorHash(secret, utcDayString(new Date()), ip, request.headers.get("user-agent") ?? "", host ?? ""),
      referrer_host: referrerHost(
        typeof body.ref === "string" ? body.ref : null,
        process.env.ROOT_DOMAIN ?? process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "",
      ),
      device: ua.device,
      browser: ua.browser,
      os: ua.os,
      country: geo.country,
      region: geo.region,
      city: geo.city,
    });
    if (error) console.error("[collect] insert failed", error.message);
  } catch (e) {
    console.error("[collect]", (e as Error).message);
  }
  return noContent();
}
