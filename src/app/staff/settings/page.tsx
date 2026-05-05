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
      .select("name, primary_color, logo_url, slug, custom_domain, phone, portal_theme, google_review_url")
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
        initialTheme={((org as { portal_theme?: string } | null)?.portal_theme ?? "dark") as "dark" | "light" | "glass"}
        initialGoogleReviewUrl={(org as { google_review_url?: string | null } | null)?.google_review_url ?? ""}
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

      <section className="flex flex-col gap-3 rounded-lg border p-4">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Booking widget
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Embed this on your website so customers can request appointments directly.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          {locations.map((l) => (
            <div key={l.id} className="flex flex-col gap-1">
              <p className="text-xs font-medium text-muted-foreground">{l.name}</p>
              <pre className="rounded-md bg-muted px-3 py-2 text-xs font-mono whitespace-pre-wrap break-all select-all">
{`<iframe
  src="https://${l.slug}.${ROOT_HOST}/book"
  width="100%"
  height="680"
  style="border:none;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,0.08)"
  title="Book an appointment at ${org?.name ?? ""}"
  loading="lazy">
</iframe>`}
              </pre>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
