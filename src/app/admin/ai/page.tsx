import { connection } from "next/server";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchOrgOverview, formatGbp } from "@/lib/platform-stats";


type AiRow = { feature: string; model: string; input_tokens: number; output_tokens: number; cost_pence: number };

export default async function AdminAiPage() {
  await connection(); // PPR: 30-day window uses Date.now() before any data read
  const admin = createAdminClient();
  // eslint-disable-next-line react-hooks/purity -- server component: a 30-day window boundary; freshness is the point
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [rows, eventsRes] = await Promise.all([
    fetchOrgOverview(),
    admin
      .from("ai_usage_events")
      .select("feature, model, input_tokens, output_tokens, cost_pence")
      .gte("created_at", since)
      .limit(50000) as unknown as Promise<{ data: AiRow[] | null }>,
  ]);

  const leaderboard = [...rows]
    .map((r) => ({
      id: r.organization_id,
      name: r.name,
      calls: Number(r.ai_events_30d),
      tokens: Number(r.ai_input_tokens_30d) + Number(r.ai_output_tokens_30d),
      pence: Number(r.ai_cost_pence_30d),
    }))
    .filter((r) => r.calls > 0)
    .sort((a, b) => b.pence - a.pence);

  const byFeature = new Map<string, { calls: number; tokens: number; pence: number }>();
  for (const e of eventsRes.data ?? []) {
    const cur = byFeature.get(e.feature) ?? { calls: 0, tokens: 0, pence: 0 };
    cur.calls += 1;
    cur.tokens += Number(e.input_tokens) + Number(e.output_tokens);
    cur.pence += Number(e.cost_pence);
    byFeature.set(e.feature, cur);
  }
  const features = [...byFeature.entries()].sort((a, b) => b[1].pence - a[1].pence);

  const totalPence = leaderboard.reduce((s, r) => s + r.pence, 0);
  const totalCalls = leaderboard.reduce((s, r) => s + r.calls, 0);

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[12.5px] text-[#9aa1ad]">
        Last 30 days · {formatGbp(totalPence, { minor: true })} estimated · {totalCalls.toLocaleString("en-GB")} calls.
        Cost is an estimate from token counts — see <span className="font-mono">ai-usage.ts</span>.
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-semibold">By organisation</h2>
          <div className="overflow-x-auto rounded-xl border border-[#23272f]">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-[#15181d] text-xs text-[#9aa1ad]">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Organisation</th>
                  <th className="px-3 py-2 text-right font-medium">Calls</th>
                  <th className="px-3 py-2 text-right font-medium">Tokens</th>
                  <th className="px-3 py-2 text-right font-medium">Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((r) => (
                  <tr key={r.id} className="border-t border-[#23272f] hover:bg-white/[0.02]">
                    <td className="px-3 py-2">
                      <Link href={`/admin/orgs/${r.id}`} className="text-white hover:underline">
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.calls.toLocaleString("en-GB")}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.tokens.toLocaleString("en-GB")}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatGbp(r.pence, { minor: true })}</td>
                  </tr>
                ))}
                {leaderboard.length === 0 && (
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

        <div>
          <h2 className="mb-2 text-sm font-semibold">By feature</h2>
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
      </div>
    </div>
  );
}
