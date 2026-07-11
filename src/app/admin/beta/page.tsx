import { createAdminClient } from "@/lib/supabase/admin";
import { BETA_SURFACES, daysLive } from "@/lib/beta-registry";

// Beta-surface tracker (#456): what currently wears a BETA chip, how long
// it's been out, and how much it's actually used — so the beta-drop gate
// comes off on evidence rather than vibes. The graduation metric is
// DISTINCT ORGS (adoption breadth — one busy garage can't inflate it);
// raw events are the volume column. Sources: audit_log actions +
// ai_usage_events features, cross-tenant.

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

type UsageRow = { organization_id: string | null; created_at: string };

type SurfaceStats = {
  key: string;
  label: string;
  chipNote: string;
  launchedOn: string;
  days: number;
  orgs: number;
  orgs7d: number;
  events: number;
  events7d: number;
  /** Events per week, oldest → newest (4 weeks). */
  trend: number[];
  lastUsedAt: string | null;
};

const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const fmtWhen = (d: string | null) =>
  d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never";

// Pure rollup so the maths stays testable at a glance: 7d splits, distinct
// orgs, and a 4-week trend from raw {org, created_at} rows.
function rollup(rows: UsageRow[], now: Date): Omit<SurfaceStats, "key" | "label" | "chipNote" | "launchedOn" | "days"> {
  const nowMs = now.getTime();
  const weekAgo = nowMs - 7 * DAY;
  const orgs = new Set<string>();
  const orgs7dSet = new Set<string>();
  const trend = [0, 0, 0, 0];
  let events7d = 0;
  let lastUsedAt: string | null = null;

  for (const r of rows) {
    const t = new Date(r.created_at).getTime();
    if (r.organization_id) {
      orgs.add(r.organization_id);
      if (t >= weekAgo) orgs7dSet.add(r.organization_id);
    }
    if (t >= weekAgo) events7d++;
    const weeksAgo = Math.floor((nowMs - t) / (7 * DAY));
    if (weeksAgo >= 0 && weeksAgo < 4) trend[3 - weeksAgo]++;
    if (!lastUsedAt || r.created_at > lastUsedAt) lastUsedAt = r.created_at;
  }

  return { orgs: orgs.size, orgs7d: orgs7dSet.size, events: rows.length, events7d, trend, lastUsedAt };
}

async function surfaceStats(): Promise<SurfaceStats[]> {
  const admin = createAdminClient();
  const now = new Date();

  return Promise.all(
    BETA_SURFACES.map(async (s) => {
      const [auditRes, aiRes] = await Promise.all([
        s.auditActions.length
          ? admin.from("audit_log").select("organization_id, created_at").in("action", s.auditActions).limit(50_000)
          : Promise.resolve({ data: [] }),
        s.aiFeatures.length
          ? admin.from("ai_usage_events").select("organization_id, created_at").in("feature", s.aiFeatures).limit(50_000)
          : Promise.resolve({ data: [] }),
      ]);
      const rows = [...((auditRes.data ?? []) as UsageRow[]), ...((aiRes.data ?? []) as UsageRow[])];
      return {
        key: s.key,
        label: s.label,
        chipNote: "navKey" in s.chip ? `nav · ${s.chip.navKey}` : s.chip.note,
        launchedOn: s.launchedOn,
        days: daysLive(s.launchedOn, now),
        ...rollup(rows, now),
      };
    }),
  );
}

function Trend({ weeks }: { weeks: number[] }) {
  const max = Math.max(...weeks, 1);
  return (
    <span className="inline-flex items-end gap-[3px]" title={`Events per week, oldest → newest: ${weeks.join(" · ")}`}>
      {weeks.map((w, i) => (
        <span
          key={i}
          className={`w-[7px] rounded-sm ${w === 0 ? "bg-[#22262e]" : "bg-[#5fdd9d]"}`}
          style={{ height: `${4 + Math.round((w / max) * 18)}px` }}
        />
      ))}
    </span>
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
          (#456). <span className="text-[#e6e8eb]">Orgs</span> = distinct garages (the graduation metric);
          events = audit-log actions + AI calls, all tenants.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[#22262e]">
        <table className="w-full min-w-[880px] text-sm">
          <thead className="bg-[#14181e] text-left text-[11px] uppercase tracking-[0.08em] text-[#5a6170]">
            <tr>
              <th className="px-4 py-2.5 font-medium">Surface</th>
              <th className="px-4 py-2.5 font-medium">Launched</th>
              <th className="px-4 py-2.5 text-right font-medium">Days</th>
              <th className="px-4 py-2.5 text-right font-medium">Orgs · 7d</th>
              <th className="px-4 py-2.5 text-right font-medium">Orgs · total</th>
              <th className="px-4 py-2.5 text-right font-medium">Events · 7d</th>
              <th className="px-4 py-2.5 text-right font-medium">Events · total</th>
              <th className="px-4 py-2.5 font-medium">4-week trend</th>
              <th className="px-4 py-2.5 font-medium">Last used</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.key} className="border-t border-[#22262e]">
                <td className="px-4 py-2.5">
                  <span className="font-medium">{s.label}</span>
                  <span className="mt-0.5 block text-[11px] text-[#5a6170]">{s.chipNote}</span>
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-[#9aa1ad]">{fmtDate(s.launchedOn)}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums">{s.days}</td>
                <td className={`px-4 py-2.5 text-right font-mono text-base tabular-nums ${s.orgs7d === 0 ? "text-[#ff7b7b]" : "text-[#5fdd9d]"}`}>
                  {s.orgs7d}
                </td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums">{s.orgs}</td>
                <td className={`px-4 py-2.5 text-right font-mono tabular-nums ${s.events7d === 0 ? "text-[#5a6170]" : ""}`}>
                  {s.events7d.toLocaleString("en-GB")}
                </td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums">{s.events.toLocaleString("en-GB")}</td>
                <td className="px-4 py-2.5">
                  <Trend weeks={s.trend} />
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-[#9aa1ad]">{fmtWhen(s.lastUsedAt)}</td>
              </tr>
            ))}
            {stats.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-[#5a6170]">
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
