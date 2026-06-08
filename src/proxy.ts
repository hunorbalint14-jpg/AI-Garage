import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { resolveTenantFromHost } from "@/lib/tenant";

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
    extraHeaders["x-tenant-slug"] = tenant.slug;
  }

  return updateSession(request, extraHeaders);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
