import Link from "next/link";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { SettingsForm } from "./settings-form";
import { AddLocationForm } from "./add-location-form";
import { LocationsManager } from "./locations-manager";
import { BusinessHoursForm } from "./business-hours-form";
import { PasskeysSection, type PasskeyRow } from "./passkeys-section";
import { PaymentsSection } from "./payments-section";
import { QuoteDepositSection } from "./quote-deposit-section";
import { QuoteValiditySection } from "./quote-validity-section";
import { XeroSection } from "./xero-section";
import { FinanceSection } from "./finance-section";
import { NoShowFeeSection } from "./no-show-fee-section";
import { SermiCard, type SermiView } from "./sermi-card";
import { EvQualsRoster, type StaffQualView } from "./ev-quals-roster";
import { listLocationStaff } from "@/lib/staff-directory";
import { isHvQualified, qualExpired } from "@/lib/ev-readiness";
import type { FinanceConfigView } from "./finance-actions";
import { SettingsTabs, isSettingsTab } from "./settings-tabs";

type LocationRow = { id: string; slug: string; name: string; created_at: string };

const ROOT = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localtest.me:3000";
const ROOT_HOST = ROOT.split(":")[0];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: tabParam } = await searchParams;
  const tab = isSettingsTab(tabParam) ? tabParam : "business";

  const ctx = await requireStaffContext();

  const admin = createAdminClient();
  const [orgRes, locationsRes, currentLocRes, passkeysRes, financeRes] = await Promise.all([
    admin
      .from("organizations")
      .select("name, primary_color, logo_url, slug, custom_domain, phone, google_review_url, privacy_policy_url, dpa_version, dpa_accepted_at, stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted, xero_tenant_id, xero_tenant_name, xero_connected_at, quote_deposit_pct, quote_validity_days, no_show_fee_pence")
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
    admin
      .from("finance_provider_configs")
      .select("provider, enabled, demo_mode, min_amount, api_key_encrypted, secret_encrypted")
      .eq("organization_id", ctx.organization.id)
      .eq("provider", "bumper")
      .maybeSingle(),
  ]);

  const org = orgRes.data;
  const locations = (locationsRes.data ?? []) as LocationRow[];
  const isOwner = ctx.orgRole === "owner" || ctx.orgRole === "admin";
  const locHours = currentLocRes.data as { business_hours_start?: number; business_hours_end?: number } | null;
  const passkeys = (passkeysRes.data ?? []) as PasskeyRow[];

  const stripeAccountId = (org as { stripe_account_id?: string | null } | null)?.stripe_account_id;
  const stripeChargesEnabled = !!(org as { stripe_charges_enabled?: boolean } | null)?.stripe_charges_enabled;

  type FinanceRow = { provider: "bumper"; enabled: boolean; demo_mode: boolean; min_amount: number; api_key_encrypted: string | null; secret_encrypted: string | null };
  const financeRow = financeRes.data as FinanceRow | null;
  // Credentials are write-only: the client only learns whether they exist.
  const financeView: FinanceConfigView | null = financeRow
    ? {
        provider: financeRow.provider,
        enabled: financeRow.enabled,
        demoMode: financeRow.demo_mode,
        minAmount: Number(financeRow.min_amount) || 0,
        hasCredentials: !!(financeRow.api_key_encrypted && financeRow.secret_encrypted),
      }
    : null;

  // Compliance tab data (SERMI + EV qualification roster) — only fetched when
  // that tab is open, since most Settings visits don't need it.
  let sermi: SermiView | null = null;
  let evRows: StaffQualView[] = [];
  if (tab === "compliance") {
    const [readinessRes, qualsRes, staffList] = await Promise.all([
      admin
        .from("location_ev_readiness")
        .select("sermi_status, sermi_reference, sermi_expires_at, notes")
        .eq("location_id", ctx.location.id)
        .maybeSingle(),
      admin
        .from("location_users")
        .select("user_id, ev_level, ev_certified_at, ev_expires_at")
        .eq("location_id", ctx.location.id),
      listLocationStaff(ctx.location.id, ctx.organization.id),
    ]);
    sermi = {
      status: (readinessRes.data?.sermi_status as SermiView["status"]) ?? "not_applied",
      reference: readinessRes.data?.sermi_reference ?? "",
      expiresAt: readinessRes.data?.sermi_expires_at ?? "",
      notes: readinessRes.data?.notes ?? "",
    };
    type QualRow = { user_id: string; ev_level: number | null; ev_certified_at: string | null; ev_expires_at: string | null };
    const qualByUser = new Map(((qualsRes.data ?? []) as QualRow[]).map((q) => [q.user_id, q]));
    evRows = staffList.map((s) => {
      const q = qualByUser.get(s.id);
      return {
        userId: s.id,
        name: s.name,
        level: q?.ev_level ?? 0,
        certifiedAt: q?.ev_certified_at ?? "",
        expiresAt: q?.ev_expires_at ?? "",
        expired: qualExpired(q?.ev_expires_at),
      };
    });
  }
  const evQualifiedCount = evRows.filter((r) => isHvQualified(r.level) && !r.expired).length;

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your organisation&apos;s configuration.
        </p>
      </div>

      <SettingsTabs active={tab} />

      {/* ── Business ─────────────────────────────────────────────── */}
      {tab === "business" && (
        <SettingsForm
          initialName={org?.name ?? ""}
          initialColor={org?.primary_color ?? "#1f2937"}
          initialLogoUrl={org?.logo_url ?? ""}
          initialPhone={(org as { phone?: string | null } | null)?.phone ?? ""}
          initialGoogleReviewUrl={(org as { google_review_url?: string | null } | null)?.google_review_url ?? ""}
          initialPrivacyPolicyUrl={(org as { privacy_policy_url?: string | null } | null)?.privacy_policy_url ?? ""}
          canEdit={isOwner}
        />
      )}

      {/* ── Booking ──────────────────────────────────────────────── */}
      {tab === "booking" && (
        <>
          {ctx.accessibleLocations.length > 1 && (
            <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
              Editing business hours for{" "}
              <span className="font-medium text-foreground">{ctx.location.name}</span>. Use the branch
              switcher in the top bar to configure a different branch.
            </p>
          )}
          <BusinessHoursForm
            initialStart={locHours?.business_hours_start ?? 8}
            initialEnd={locHours?.business_hours_end ?? 18}
            canEdit={isOwner}
          />

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
        </>
      )}

      {/* ── Payments & Quotes ────────────────────────────────────── */}
      {tab === "payments" && (
        <>
          <PaymentsSection
            hasStripeAccount={!!stripeAccountId}
            chargesEnabled={stripeChargesEnabled}
            payoutsEnabled={!!(org as { stripe_payouts_enabled?: boolean } | null)?.stripe_payouts_enabled}
            detailsSubmitted={!!(org as { stripe_details_submitted?: boolean } | null)?.stripe_details_submitted}
            canManage={isOwner}
          />

          <QuoteDepositSection
            initialPct={Number((org as { quote_deposit_pct?: number | null } | null)?.quote_deposit_pct ?? 0)}
            canManage={isOwner}
            stripeActive={!!stripeAccountId && stripeChargesEnabled}
          />

          <QuoteValiditySection
            initialDays={Number((org as { quote_validity_days?: number | null } | null)?.quote_validity_days ?? 30)}
            canManage={isOwner}
          />

          <NoShowFeeSection
            initialFeePence={Number((org as { no_show_fee_pence?: number | null } | null)?.no_show_fee_pence ?? 0)}
            canManage={isOwner}
            stripeActive={!!stripeAccountId && stripeChargesEnabled}
          />

          <FinanceSection initial={financeView} canManage={isOwner} />
        </>
      )}

      {/* ── Integrations ─────────────────────────────────────────── */}
      {tab === "integrations" && (
        <XeroSection
          connected={!!(org as { xero_tenant_id?: string | null } | null)?.xero_tenant_id}
          tenantName={(org as { xero_tenant_name?: string | null } | null)?.xero_tenant_name ?? null}
          connectedAt={(org as { xero_connected_at?: string | null } | null)?.xero_connected_at ?? null}
          canManage={isOwner}
        />
      )}

      {/* ── Compliance ───────────────────────────────────────────── */}
      {tab === "compliance" && sermi && (
        <>
          {ctx.accessibleLocations.length > 1 && (
            <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
              SERMI &amp; EV qualifications shown for{" "}
              <span className="font-medium text-foreground">{ctx.location.name}</span>. Use the branch
              switcher in the top bar to configure a different branch.
            </p>
          )}
          <SermiCard sermi={sermi} canManage={isOwner} />

          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                Technician EV qualifications
              </h2>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  evQualifiedCount > 0 ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                }`}
              >
                {evQualifiedCount} HV-qualified
              </span>
            </div>
            <EvQualsRoster rows={evRows} />
            <p className="text-xs text-muted-foreground">
              Levels follow IMI TechSafe. Level 2 or above (in date) qualifies a technician for
              high-voltage work — flag those jobs with the high-voltage toggle on the job card.
              {isOwner && (
                <>
                  {" "}Set each technician&apos;s qualification on the{" "}
                  <Link href="/staff/staff-members" className="underline">Team page</Link>.
                </>
              )}
            </p>
          </section>
        </>
      )}

      {/* ── Locations ────────────────────────────────────────────── */}
      {tab === "locations" && (
        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <div>
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Locations
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Each location gets its own subdomain and customer list.
            </p>
          </div>

          <LocationsManager
            locations={locations}
            primaryLocationId={ctx.organization.primary_location_id}
            canManage={isOwner}
            rootHost={ROOT_HOST}
          />

          {isOwner && <AddLocationForm />}
        </section>
      )}

      {/* ── Security & Legal ─────────────────────────────────────── */}
      {tab === "security" && (
        <>
          <PasskeysSection initialPasskeys={passkeys} />

          {isOwner && (
            <section className="flex flex-col gap-2 rounded-lg border p-4">
              <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                Team roles
              </h2>
              <p className="text-xs text-muted-foreground">
                Manage permission templates: clone system presets (Mechanic, Service Advisor, etc.) or create custom profiles for your shop.
              </p>
              <div>
                <Link
                  href="/staff/settings/team-roles"
                  className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm hover:bg-muted/40"
                >
                  Manage templates →
                </Link>
              </div>
            </section>
          )}

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
        </>
      )}
    </div>
  );
}
