import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  const ctx = await requireStaffContext();

  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("name, primary_color, logo_url, slug, custom_domain, phone")
    .eq("id", ctx.organization.id)
    .single();

  const isOwner = ctx.orgRole === "owner" || ctx.orgRole === "admin";

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your organisation&apos;s branding and details.
        </p>
      </div>

      <section className="rounded-lg border p-4">
        <h2 className="mb-1 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Subdomain
        </h2>
        <p className="text-sm">
          <span className="font-mono">{org?.slug}</span>
          <span className="text-muted-foreground">.garage-ai.com</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Subdomains cannot be changed after signup. Contact support if you need
          a different one.
        </p>
      </section>

      <SettingsForm
        initialName={org?.name ?? ""}
        initialColor={org?.primary_color ?? "#1f2937"}
        initialLogoUrl={org?.logo_url ?? ""}
        initialPhone={(org as { phone?: string | null } | null)?.phone ?? ""}
        canEdit={isOwner}
      />
    </div>
  );
}
