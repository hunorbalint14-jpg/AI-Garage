import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTenantFromHost } from "@/lib/tenant";


export default async function DebugPage() {
  const headersList = await headers();

  const host = headersList.get("host") ?? "(none)";
  const xForwardedHost = headersList.get("x-forwarded-host") ?? "(none)";
  const xTenantSlug = headersList.get("x-tenant-slug") ?? "(none)";

  const resolvedSlug =
    headersList.get("x-tenant-slug") ??
    resolveTenantFromHost(
      headersList.get("host") ?? headersList.get("x-forwarded-host") ?? "",
    ).slug;

  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  let locationRow: unknown = null;
  let orgCheck: unknown = null;
  let locCheck: unknown = null;

  if (resolvedSlug) {
    const admin = createAdminClient();
    const { data: loc, error: locErr } = await admin
      .from("locations")
      .select("id, slug, name, organization_id, organization:organizations(id, slug, name)")
      .eq("slug", resolvedSlug)
      .maybeSingle();
    locationRow = loc ?? locErr ?? null;

    if (loc && user) {
      const [o, l] = await Promise.all([
        admin.from("org_users").select("role").eq("user_id", user.id).eq("organization_id", loc.organization_id).maybeSingle(),
        admin.from("location_users").select("role").eq("user_id", user.id).eq("location_id", loc.id).maybeSingle(),
      ]);
      orgCheck = o.data ?? o.error ?? null;
      locCheck = l.data ?? l.error ?? null;
    }
  }

  const dump = {
    headers: { host, xForwardedHost, xTenantSlug },
    resolvedSlug,
    user: user ? { id: user.id, email: user.email } : null,
    userError: userError?.message ?? null,
    locationRow,
    orgCheck,
    locCheck,
  };

  return (
    <pre style={{ padding: 24, fontFamily: "monospace", fontSize: 13, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
      {JSON.stringify(dump, null, 2)}
    </pre>
  );
}
