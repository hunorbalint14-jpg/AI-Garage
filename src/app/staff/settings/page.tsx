import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { SettingsForm } from "./settings-form";
import { AddLocationForm } from "./add-location-form";

type LocationRow = { id: string; slug: string; name: string; created_at: string };

const ROOT = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localtest.me:3000";
const ROOT_HOST = ROOT.split(":")[0];

export default async function SettingsPage() {
  const ctx = await requireStaffContext();

  const admin = createAdminClient();
  const [orgRes, locationsRes] = await Promise.all([
    admin
      .from("organizations")
      .select("name, primary_color, logo_url, slug, custom_domain, phone")
      .eq("id", ctx.organization.id)
      .single(),
    admin
      .from("locations")
      .select("id, slug, name, created_at")
      .eq("organization_id", ctx.organization.id)
      .order("created_at", { ascending: true }),
  ]);

  const org = orgRes.data;
  const locations = (locationsRes.data ?? []) as LocationRow[];
  const isOwner = ctx.orgRole === "owner" || ctx.orgRole === "admin";

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your organisation&apos;s branding and details.
        </p>
      </div>

      <SettingsForm
        initialName={org?.name ?? ""}
        initialColor={org?.primary_color ?? "#1f2937"}
        initialLogoUrl={org?.logo_url ?? ""}
        initialPhone={(org as { phone?: string | null } | null)?.phone ?? ""}
        canEdit={isOwner}
      />

      <section className="flex flex-col gap-3 rounded-lg border p-4">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Locations
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Each location gets its own subdomain and customer list.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          {locations.map((l) => (
            <div
              key={l.id}
              className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
            >
              <span className="font-medium">{l.name}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {l.slug}.{ROOT_HOST}
              </span>
            </div>
          ))}
        </div>

        {isOwner && <AddLocationForm />}
      </section>
    </div>
  );
}
