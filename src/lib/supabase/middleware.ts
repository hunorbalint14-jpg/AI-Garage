import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(
  request: NextRequest,
  extraRequestHeaders?: Record<string, string>,
) {
  // Merge any extra headers (e.g. x-tenant-slug) into the forwarded request
  // so server components can read them via request.headers / headers().
  const forwardHeaders = new Headers(request.headers);
  if (extraRequestHeaders) {
    for (const [k, v] of Object.entries(extraRequestHeaders)) {
      forwardHeaders.set(k, v);
    }
  }

  let supabaseResponse = NextResponse.next({
    request: { headers: forwardHeaders },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request: { headers: forwardHeaders },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  await supabase.auth.getUser();

  return supabaseResponse;
}
