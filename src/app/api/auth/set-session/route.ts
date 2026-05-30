import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { enforceRateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { resolvePortalForUser } from "@/lib/tenant-data";

// Bridge endpoint used by the /auth/callback HTML shim. Receives the access +
// refresh tokens the magiclink left in the URL fragment, calls supabase.setSession
// to write the session cookies on this domain, and returns 200 so the page-side
// script can navigate the user to /staff (or whatever `next` was).
//
// Why this exists: admin-generated invite + magiclinks use the legacy implicit
// flow (#access_token=...). The hash never reaches the server, so we bridge it
// here client-side. PKCE (?code=) handled separately in /auth/callback GET.
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit("token");
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many attempts." },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }

  let body: { access_token?: unknown; refresh_token?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const accessToken = typeof body.access_token === "string" ? body.access_token : null;
  const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : null;
  if (!accessToken || !refreshToken) {
    return NextResponse.json({ error: "missing_tokens" }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookies) {
          for (const c of cookies) {
            response.cookies.set(
              c.name,
              c.value,
              c.options as Parameters<typeof response.cookies.set>[2],
            );
          }
        },
      },
    },
  );

  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }

  // Log the login — no overlap with /auth/callback because that route only
  // reaches set-session when there is no ?code= (legacy implicit flow).
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { portal, organizationId } = await resolvePortalForUser(user.id);
      await logAudit({
        action: "auth.login",
        actorUserId: user.id,
        actorEmail: user.email ?? null,
        organizationId,
        metadata: { method: "magiclink", portal },
      });
    }
  } catch {
    // Never let audit failure affect the session response
  }

  return response;
}
