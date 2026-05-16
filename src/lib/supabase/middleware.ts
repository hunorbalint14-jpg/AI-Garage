import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const SESSION_STARTED_COOKIE = "ai_session_started_at";
const MAX_SESSION_MS = 12 * 60 * 60 * 1000; // 12 hours

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

  let user: { id: string } | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user as { id: string } | null;
  } catch {
    // Invalid/expired session — let routes handle redirect to login
  }

  // 12-hour absolute session timeout
  if (user) {
    const startedRaw = request.cookies.get(SESSION_STARTED_COOKIE)?.value;
    const now = Date.now();
    if (!startedRaw) {
      // First request after sign-in — stamp the session start
      supabaseResponse.cookies.set(SESSION_STARTED_COOKIE, String(now), {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: Math.floor(MAX_SESSION_MS / 1000),
      });
    } else {
      const startedAt = parseInt(startedRaw, 10);
      if (Number.isFinite(startedAt) && now - startedAt > MAX_SESSION_MS) {
        // Session expired — sign out + redirect to login
        try {
          await supabase.auth.signOut();
        } catch {
          // Ignore
        }
        const pathname = request.nextUrl.pathname;
        const isApi = pathname.startsWith("/api/");
        const isStaff = pathname.startsWith("/staff");
        if (isApi) {
          const res = NextResponse.json(
            { error: "Session expired. Please sign in again." },
            { status: 401 },
          );
          res.cookies.delete(SESSION_STARTED_COOKIE);
          for (const c of request.cookies.getAll()) {
            if (c.name.startsWith("sb-")) res.cookies.delete(c.name);
          }
          return res;
        }
        const loginPath = isStaff ? "/staff/login" : "/login";
        const redirectUrl = new URL(loginPath, request.url);
        redirectUrl.searchParams.set("expired", "1");
        const res = NextResponse.redirect(redirectUrl);
        res.cookies.delete(SESSION_STARTED_COOKIE);
        for (const c of request.cookies.getAll()) {
          if (c.name.startsWith("sb-")) res.cookies.delete(c.name);
        }
        return res;
      }
    }
  } else {
    // No user — make sure stale start cookie is cleared
    if (request.cookies.get(SESSION_STARTED_COOKIE)) {
      supabaseResponse.cookies.delete(SESSION_STARTED_COOKIE);
    }
  }

  return supabaseResponse;
}
