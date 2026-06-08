import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { resolveTenantFromHost } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase/admin";

const ROOT = process.env.ROOT_DOMAIN ?? process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localtest.me:3000";
const ROOT_HOST = ROOT.split(":")[0];
const ROOT_PORT = ROOT.includes(":") ? ROOT.split(":")[1] : "";

// If `slug` is a retired location slug, 308-redirect to the location's CURRENT
// subdomain, preserving path + query. Returns null when the slug isn't retired
// (the common case — a single indexed lookup on a small table).
async function retiredSlugRedirect(request: NextRequest, slug: string): Promise<NextResponse | null> {
  try {
    const admin = createAdminClient();
    const { data } = (await admin
      .from("location_slug_history")
      .select("location:locations(slug)")
      .eq("old_slug", slug)
      .maybeSingle()) as { data: { location: { slug: string } | null } | null };
    const current = data?.location?.slug;
    if (!current || current === slug) return null;
    const url = request.nextUrl.clone();
    url.hostname = `${current}.${ROOT_HOST}`;
    if (ROOT_PORT) url.port = ROOT_PORT;
    return NextResponse.redirect(url, 308);
  } catch {
    return null; // never block a request on the history lookup
  }
}

export async function proxy(request: NextRequest) {
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

  return updateSession(request, extraHeaders);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
