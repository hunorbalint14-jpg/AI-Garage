import { createAdminClient } from "@/lib/supabase/admin";
import { BETA_SURFACES, daysLive } from "@/lib/beta-registry";

// Beta-surface tracker (#456): what currently wears a BETA chip, how long
// it's been out, and how much it's actually used — so the beta-drop gate
// comes off on evidence rather than vibes. Usage = audit_log actions +
// ai_usage_events features, cross-tenant (platform view).

export const dynamic = "force-dynamic";

type SurfaceStats = {
  key: string;
  label: string;
  chipNote: string;
  launchedOn: string;
  days: number;
  total: number;
  last7d: number;
  lastUsedAt: string | null;
};

const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const fmtWhen = (d: string | null) =>
  d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never";

async function surfaceStats(): Promise<SurfaceStats[]> {
  const admin = createAdminClient();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

  return Promise.all(
    BETA_SURFACES.map(async (s) => {
      const [auditTotal, audit7d, auditLast, aiTotal, ai7d, aiLast] = await Promise.all([
        s.auditActions.length
          ? admin.from("audit_log").select("id", { count: "exact", head: true }).in("action", s.auditActions)
          : Promise.resolve({ count: 0 }),
        s.auditActions.length
          ? admin
              .from("audit_log")
              .select("id", { count: "exact", head: true })
              .in("action", s.auditActions)
              .gte("created_at", sevenDaysAgo)
          : Promise.resolve({ count: 0 }),
        s.auditActions.length
          ? admin
              .from("audit_log")
              .select("created_at")
              .in("action", s.auditActions)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        s.aiFeatures.length
          ? admin.from("ai_usage_events").select("id", { count: "exact", head: true }).in("feature", s.aiFeatures)
          : Promise.resolve({ count: 0 }),
        s.aiFeatures.length
          ? admin
              .from("ai_usage_events")
              .select("id", { count: "exact", head: true })
              .in("feature", s.aiFeatures)
              .gte("created_at", sevenDaysAgo)
          : Promise.resolve({ count: 0 }),
        s.aiFeatures.length
          ? admin
              .from("ai_usage_events")
              .select("created_at")
              .in("feature", s.aiFeatures)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      const lastAudit = (auditLast.data as { created_at: string } | null)?.created_at ?? null;
      const lastAi = (aiLast.data as { created_at: string } | null)?.created_at ?? null;
      const lastUsedAt = [lastAudit, lastAi].filter(Boolean).sort().pop() ?? null;

      return {
        key: s.key,
        label: s.label,
        chipNote: "navKey" in s.chip ? `nav · ${s.chip.navKey}` : s.chip.note,
        launchedOn: s.launchedOn,
        days: daysLive(s.launchedOn),
        total: (auditTotal.count ?? 0) + (aiTotal.count ?? 0),
        last7d: (audit7d.count ?? 0) + (ai7d.count ?? 0),
        lastUsedAt,
      };
    }),
  );
}

export default async function AdminBetaPage() {
  const stats = await surfaceStats();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Beta surfaces</h1>
        <p className="mt-1 text-sm text-[#9aa1ad]">
          Everything currently framed as beta, with real usage — the evidence side of the beta-drop gate
          (#456). Usage counts audit-log actions + AI calls across all tenants.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[#22262e]">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-[#14181e] text-left text-[11px] uppercase tracking-[0.08em] text-[#5a6170]">
            <tr>
              <th className="px-4 py-2.5 font-medium">Surface</th>
              <th className="px-4 py-2.5 font-medium">Chip</th>
              <th className="px-4 py-2.5 font-medium">Launched</th>
              <th className="px-4 py-2.5 text-right font-medium">Days in beta</th>
              <th className="px-4 py-2.5 text-right font-medium">Uses · total</th>
              <th className="px-4 py-2.5 text-right font-medium">Uses · 7d</th>
              <th className="px-4 py-2.5 font-medium">Last used</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.key} className="border-t border-[#22262e]">
                <td className="px-4 py-2.5 font-medium">{s.label}</td>
                <td className="px-4 py-2.5 text-xs text-[#9aa1ad]">{s.chipNote}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-[#9aa1ad]">{fmtDate(s.launchedOn)}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums">{s.days}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums">{s.total.toLocaleString("en-GB")}</td>
                <td className={`px-4 py-2.5 text-right font-mono tabular-nums ${s.last7d === 0 ? "text-[#5a6170]" : ""}`}>
                  {s.last7d.toLocaleString("en-GB")}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-[#9aa1ad]">{fmtWhen(s.lastUsedAt)}</td>
              </tr>
            ))}
            {stats.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-[#5a6170]">
                  Nothing is in beta — the registry (src/lib/beta-registry.ts) is empty.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-[#5a6170]">
        Graduating a surface: remove its chip and its registry entry in the same PR — a unit test keeps
        this page and the chips in lockstep. The gate criteria live on #456.
      </p>
    </div>
  );
}
