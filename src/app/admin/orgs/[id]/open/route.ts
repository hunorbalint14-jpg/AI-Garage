import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPlatformAdminUser } from "@/lib/platform-admin";
import { logAudit } from "@/lib/audit";

const ROOT = process.env.ROOT_DOMAIN ?? process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localtest.me:3000";
const ROOT_HOST = ROOT.split(":")[0];
const PORT = ROOT.includes(":") ? `:${ROOT.split(":")[1]}` : "";
const PROTO =
  ROOT_HOST === "localhost" || ROOT_HOST.endsWith("localtest.me") || ROOT_HOST.endsWith(".local") ? "http" : "https";

// "Open portal as admin" — mints a one-time cross-subdomain sign-in link to a
// tenant's /staff and redirects there. Gated independently of the /admin layout
// (route handlers don't run layouts): must be the admin host AND a platform
// admin. Entry is audited as impersonation.start.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { origin } = new URL(request.url);

  if (request.headers.get("x-platform-host") !== "1") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!(await isPlatformAdminUser(user)) || !user?.email) {
    return NextResponse.redirect(`${origin}/admin/login`);
  }

  const admin = createAdminClient();
  // Open a specific branch if requested (?location=<id>), else the org's primary
  // branch, falling back to the alphabetically-first.
  const requestedLocationId = new URL(request.url).searchParams.get("location");
  const { data: org } = await admin
    .from("organizations")
    .select("primary_location_id, locations:locations(id, slug, name)")
    .eq("id", id)
    .maybeSingle();
  const locs = ((org?.locations ?? []) as { id: string; slug: string; name: string }[]).slice();
  if (locs.length === 0) {
    return NextResponse.redirect(`${origin}/admin/orgs/${id}`);
  }
  locs.sort((a, b) => a.name.localeCompare(b.name));
  const location =
    (requestedLocationId ? locs.find((l) => l.id === requestedLocationId) : undefined) ??
    locs.find((l) => l.id === (org as { primary_location_id?: string | null } | null)?.primary_location_id) ??
    locs[0];

  const { data: linkData, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
  const tokenHash = linkData?.properties?.hashed_token;
  if (error || !tokenHash) {
    return NextResponse.redirect(`${origin}/admin/orgs/${id}`);
  }

  await logAudit({
    action: "impersonation.start",
    actorUserId: user.id,
    actorEmail: user.email,
    organizationId: id,
    metadata: { via: "platform_admin", location_slug: location.slug },
  });

  const target = `${PROTO}://${location.slug}.${ROOT_HOST}${PORT}/auth/handoff?token_hash=${encodeURIComponent(tokenHash)}&next=${encodeURIComponent("/staff")}`;
  return NextResponse.redirect(target);
}
