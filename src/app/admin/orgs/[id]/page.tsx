import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  type OrgOverviewRow,
  billingState,
  planName,
  orgMrrPence,
  formatGbp,
} from "@/lib/platform-stats";
import { OrgSlugEditor } from "./org-slug-editor";
import { ReceptionistNumbers, type ReceptionistLoc } from "./receptionist-numbers";
import { fetchTrafficStats } from "@/lib/platform/traffic-stats";
import { RankPanel, Sparkline } from "@/components/admin/traffic-panels";

export const dynamic = "force-dynamic";

type AiRow = { feature: string; model: string; input_tokens: number; output_tokens: number; cost_pence: number };

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#23272f] bg-[#15181d] px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-[#5a6170]">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-white">{value}</div>
    </div>
  );
}

export default async function OrgDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = createAdminClient();

  const { data: orgRow } = (await admin
    .from("platform_org_overview")
    .select("*")
    .eq("organization_id", id)
    .maybeSingle()) as { data: OrgOverviewRow | null };

  if (!orgRow) notFound();

  const { data: locations } = await admin
    .from("locations")
    .select("id, name, slug")
    .eq("organization_id", id)
    .order("created_at", { ascending: true });
  const locationIds = (locations ?? []).map((l) => l.id);

  // Receptionist Twilio numbers, keyed by location, for the provisioning panel.
  const { data: receptionistConfigs } = await admin
    .from("receptionist_configs")
    .select("location_id, twilio_number, enabled")
    .in("location_id", locationIds.length > 0 ? locationIds : ["00000000-0000-0000-0000-000000000000"]);
  const configByLocation = new Map(
    ((receptionistConfigs ?? []) as { location_id: string; twilio_number: string | null; enabled: boolean }[]).map(
      (c) => [c.location_id, c],
    ),
  );
  const receptionistLocations: ReceptionistLoc[] = (locations ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    twilioNumber: configByLocation.get(l.id)?.twilio_number ?? null,
    enabled: configByLocation.get(l.id)?.enabled ?? false,
  }));

  // AI usage for the org over the last 30 days, aggregated in TS.
  // eslint-disable-next-line react-hooks/purity -- server component: a 30-day window boundary; freshness is the point
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [{ data: aiEvents }, traffic] = await Promise.all([
    admin
      .from("ai_usage_events")
      .select("feature, model, input_tokens, output_tokens, cost_pence")
      .eq("organization_id", id)
      .gte("created_at", since)
      .limit(10000) as unknown as Promise<{ data: AiRow[] | null }>,
    // Org-scoped web traffic, last 30 days (#admin/traffic PR 3).
    fetchTrafficStats(admin, "30d", "all", id),
  ]);
  const orgTraffic = traffic.orgs[0] ?? null;

  const byFeature = new Map<string, { calls: number; tokens: number; pence: number }>();
  for (const e of aiEvents ?? []) {
    const cur = byFeature.get(e.feature) ?? { calls: 0, tokens: 0, pence: 0 };
    cur.calls += 1;
    cur.tokens += Number(e.input_tokens) + Number(e.output_tokens);
    cur.pence += Number(e.cost_pence);
    byFeature.set(e.feature, cur);
  }
  const features = [...byFeature.entries()].sort((a, b) => b[1].pence - a[1].pence);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/admin" className="text-xs text-[#9aa1ad] hover:text-white">
            ← Overview
          </Link>
          <h1 className="mt-1 text-lg font-semibold">{orgRow.name}</h1>
          <p className="font-mono text-xs text-[#5a6170]">{orgRow.slug}</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Full navigation (not next/link) — crosses to the tenant subdomain. */}
          <a
            href={`/admin/orgs/${id}/open`}
            className="rounded-lg border border-[#2a5a3a] bg-[#13301f] px-3 py-1.5 text-xs font-semibold text-[#5fdd9d] hover:bg-[#163a26]"
          >
            Open portal as admin ↗
          </a>
        </div>
      </div>

      {/* Billing + integrations */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Plan" value={planName(orgRow)} />
        <Stat label="Billing" value={billingState(orgRow)} />
        <Stat label="MRR (est.)" value={formatGbp(orgMrrPence(orgRow))} />
        <Stat
          label="Integrations"
          value={[
            orgRow.stripe_charges_enabled ? "Stripe" : null,
            orgRow.accounting_provider === "quickbooks" ? "QuickBooks" : orgRow.accounting_provider === "sage" ? "Sage" : orgRow.accounting_provider === "xero" ? "Xero" : null,
          ].filter(Boolean).join(" + ") || "None"}
        />
      </div>

      {/* Counts */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Locations" value={String(Number(orgRow.location_count))} />
        <Stat label="Staff" value={String(Number(orgRow.staff_count))} />
        <Stat label="Customers" value={Number(orgRow.customer_count).toLocaleString("en-GB")} />
        <Stat label="Vehicles" value={Number(orgRow.vehicle_count).toLocaleString("en-GB")} />
        <Stat label="Bookings" value={Number(orgRow.booking_count).toLocaleString("en-GB")} />
        <Stat label="Jobs" value={Number(orgRow.job_count).toLocaleString("en-GB")} />
        <Stat label="Invoices" value={`${Number(orgRow.invoice_paid_count)}/${Number(orgRow.invoice_count)} paid`} />
        <Stat label="Revenue" value={formatGbp(Number(orgRow.revenue_paid_pence))} />
        <Stat label="Quotes" value={Number(orgRow.quote_count).toLocaleString("en-GB")} />
        <Stat label="Reminders sent" value={Number(orgRow.reminder_sent_count).toLocaleString("en-GB")} />
        <Stat label="AI spend (30d)" value={formatGbp(Number(orgRow.ai_cost_pence_30d), { minor: true })} />
        <Stat label="AI calls (30d)" value={Number(orgRow.ai_events_30d).toLocaleString("en-GB")} />
      </div>

      {/* Web traffic — org-scoped slice of /admin/traffic */}
      <div>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">Web traffic (30 days)</h2>
          <Link href={`/admin/traffic?org=${id}`} className="text-xs font-semibold text-[#3987e5] hover:underline">
            Open in traffic dashboard →
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Visitors" value={traffic.kpis.visitors.toLocaleString("en-GB")} />
          <Stat label="Page views" value={traffic.kpis.pageviews.toLocaleString("en-GB")} />
          <Stat label="Bookings" value={traffic.kpis.bookings.toLocaleString("en-GB")} />
          <Stat label="Booking conversion" value={traffic.kpis.convPct !== null ? `${traffic.kpis.convPct}%` : "—"} />
        </div>
        {orgTraffic && orgTraffic.visitors > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-4 rounded-lg border border-[#23272f] bg-[#15181d] px-3 py-2.5">
            <span className="text-[11px] uppercase tracking-wide text-[#5a6170]">Daily visitors</span>
            <Sparkline points={orgTraffic.spark} w={320} h={34} />
            <span
              className={`text-xs tabular-nums ${
                orgTraffic.deltaPct === null ? "text-[#5a6170]" : orgTraffic.deltaPct >= 0 ? "text-[#5fdd9d]" : "text-[#ff7b7b]"
              }`}
            >
              {orgTraffic.deltaPct === null
                ? "no previous period"
                : `${orgTraffic.deltaPct >= 0 ? "▲" : "▼"} ${Math.abs(orgTraffic.deltaPct)}% vs previous 30 days`}
            </span>
          </div>
        )}
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <RankPanel title="Top pages" sub="Tokens & ids stripped before storage." rows={traffic.paths.slice(0, 6)} />
          <RankPanel title="Top cities" sub="From edge geo headers — IPs never stored." rows={traffic.cities.slice(0, 6)} />
        </div>
      </div>

      {/* AI usage by feature */}
      <div>
        <h2 className="mb-2 text-sm font-semibold">AI usage by feature (30 days)</h2>
        <div className="overflow-x-auto rounded-xl border border-[#23272f]">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-[#15181d] text-xs text-[#9aa1ad]">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Feature</th>
                <th className="px-3 py-2 text-right font-medium">Calls</th>
                <th className="px-3 py-2 text-right font-medium">Tokens</th>
                <th className="px-3 py-2 text-right font-medium">Est. cost</th>
              </tr>
            </thead>
            <tbody>
              {features.map(([feature, v]) => (
                <tr key={feature} className="border-t border-[#23272f]">
                  <td className="px-3 py-2 font-mono text-xs text-[#c7ccd4]">{feature}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{v.calls.toLocaleString("en-GB")}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{v.tokens.toLocaleString("en-GB")}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatGbp(v.pence, { minor: true })}</td>
                </tr>
              ))}
              {features.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-sm text-[#5a6170]">
                    No AI usage in the last 30 days.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Web address — the org slug (subdomain), editable on client request */}
      <div>
        <h2 className="mb-2 text-sm font-semibold">Web address</h2>
        <OrgSlugEditor
          orgId={id}
          slug={orgRow.slug}
          branches={(locations ?? []).map((l) => ({ id: l.id, name: l.name, slug: l.slug }))}
        />
      </div>

      {/* AI receptionist — buy/release a Twilio number per location */}
      <div>
        <h2 className="mb-2 text-sm font-semibold">AI receptionist numbers</h2>
        <ReceptionistNumbers locations={receptionistLocations} />
      </div>
    </div>
  );
}
