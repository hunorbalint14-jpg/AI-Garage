import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { SettingsForm } from "./settings-form";
import { AddLocationForm } from "./add-location-form";
import { BusinessHoursForm } from "./business-hours-form";
import { PasskeysSection, type PasskeyRow } from "./passkeys-section";
import { PaymentsSection } from "./payments-section";

type LocationRow = { id: string; slug: string; name: string; created_at: string };

const ROOT = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localtest.me:3000";
const ROOT_HOST = ROOT.split(":")[0];

export default async function SettingsPage() {
  const ctx = await requireStaffContext();

  const admin = createAdminClient();
  const [orgRes, locationsRes, currentLocRes, passkeysRes] = await Promise.all([
    admin
      .from("organizations")
      .select("name, primary_color, logo_url, slug, custom_domain, phone, google_review_url, privacy_policy_url, dpa_version, dpa_accepted_at, stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted")
      .eq("id", ctx.organization.id)
      .single(),
    admin
      .from("locations")
      .select("id, slug, name, created_at")
      .eq("organization_id", ctx.organization.id)
      .order("created_at", { ascending: true }),
    admin
      .from("locations")
      .select("business_hours_start, business_hours_end")
      .eq("id", ctx.location.id)
      .single(),
    admin
      .from("webauthn_credentials")
      .select("credential_id, device_name, created_at, last_used_at")
      .eq("user_id", ctx.user.id)
      .order("created_at", { ascending: false }),
  ]);

  const org = orgRes.data;
  const locations = (locationsRes.data ?? []) as LocationRow[];
  const isOwner = ctx.orgRole === "owner" || ctx.orgRole === "admin";
  const locHours = currentLocRes.data as { business_hours_start?: number; business_hours_end?: number } | null;
  const passkeys = (passkeysRes.data ?? []) as PasskeyRow[];

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
        initialGoogleReviewUrl={(org as { google_review_url?: string | null } | null)?.google_review_url ?? ""}
        initialPrivacyPolicyUrl={(org as { privacy_policy_url?: string | null } | null)?.privacy_policy_url ?? ""}
        canEdit={isOwner}
      />

      <BusinessHoursForm
        initialStart={locHours?.business_hours_start ?? 8}
        initialEnd={locHours?.business_hours_end ?? 18}
        canEdit={isOwner}
      />

      <PasskeysSection initialPasskeys={passkeys} />

      <PaymentsSection
        hasStripeAccount={!!(org as { stripe_account_id?: string | null } | null)?.stripe_account_id}
        chargesEnabled={!!(org as { stripe_charges_enabled?: boolean } | null)?.stripe_charges_enabled}
        payoutsEnabled={!!(org as { stripe_payouts_enabled?: boolean } | null)?.stripe_payouts_enabled}
        detailsSubmitted={!!(org as { stripe_details_submitted?: boolean } | null)?.stripe_details_submitted}
        canManage={isOwner}
      />

      <section className="rounded-lg border p-4">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Data Processing Agreement
        </h2>
        {(org as { dpa_version?: string; dpa_accepted_at?: string } | null)?.dpa_accepted_at ? (
          <p className="text-sm text-muted-foreground">
            Accepted version <span className="font-mono">{(org as { dpa_version?: string }).dpa_version}</span> on{" "}
            {new Date((org as { dpa_accepted_at: string }).dpa_accepted_at).toLocaleString("en-GB")}.{" "}
            <a href="/legal/dpa" target="_blank" rel="noopener noreferrer" className="underline">
              View DPA
            </a>
          </p>
        ) : (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            DPA not yet accepted.{" "}
            <a href="/staff/dpa-acceptance" className="underline">Accept now</a>
          </p>
        )}
      </section>

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
