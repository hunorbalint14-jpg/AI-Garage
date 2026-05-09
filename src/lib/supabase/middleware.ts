import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(
  request: NextRequest,
  extraRequestHeaders?: Record<string, string>,
) {
  const buildForwardHeaders = () => {
    const h = new Headers(request.headers);
    if (extraRequestHeaders) {
      for (const [k, v] of Object.entries(extraRequestHeaders)) {
        h.set(k, v);
      }
    }
    return h;
  };

  let supabaseResponse = NextResponse.next({
    request: { headers: buildForwardHeaders() },
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
          // Rebuild after cookie mutations so refreshed tokens are forwarded
          supabaseResponse = NextResponse.next({
            request: { headers: buildForwardHeaders() },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  try {
    await supabase.auth.getUser();
  } catch {
    // Invalid/expired session — let routes handle redirect to login
  }

  return supabaseResponse;
}
