import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { resolveTenantFromHost } from "@/lib/tenant";

export async function proxy(request: NextRequest) {
  const response = await updateSession(request);

  const tenant = resolveTenantFromHost(request.headers.get("host"));
  if (tenant.slug) {
    response.headers.set("x-tenant-slug", tenant.slug);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
