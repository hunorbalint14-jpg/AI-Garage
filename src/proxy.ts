import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { resolveTenantFromHost } from "@/lib/tenant";

export async function proxy(request: NextRequest) {
  const tenant = resolveTenantFromHost(request.headers.get("host"));

  const extraHeaders: Record<string, string> = {};
  if (tenant.slug) {
    extraHeaders["x-tenant-slug"] = tenant.slug;
  }

  return updateSession(request, extraHeaders);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
