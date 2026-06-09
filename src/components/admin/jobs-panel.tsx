import type { CronJob } from "@/lib/platform/cron-runs";

function statusMeta(ok: boolean | null): { label: string; dot: string; text: string } {
  if (ok === null) return { label: "no runs", dot: "bg-[#5a6170]", text: "text-[#5a6170]" };
  return ok
    ? { label: "ok", dot: "bg-[#5fdd9d]", text: "text-[#5fdd9d]" }
    : { label: "failed", dot: "bg-[#ff7b7b]", text: "text-[#ff7b7b]" };
}

function lastRun(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 90) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 90 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
}

function duration(ms: number | null): string {
  if (ms == null) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function JobsPanel({ jobs }: { jobs: CronJob[] }) {
  const notGreen = jobs.filter((j) => j.ok === false).length;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Scheduled jobs</h2>
        <span className="text-[11px] text-[#5a6170]">cron via Vercel · {notGreen} not green</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-[#23272f]">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-[#15181d] text-xs text-[#9aa1ad]">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Job</th>
              <th className="px-3 py-2 text-left font-medium">Schedule</th>
              <th className="px-3 py-2 text-right font-medium">Last run</th>
              <th className="px-3 py-2 text-right font-medium">Duration</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => {
              const m = statusMeta(j.ok);
              return (
                <tr key={j.job} className="border-t border-[#23272f]">
                  <td className="px-3 py-2">
                    <div className="font-mono font-medium text-white">{j.job}</div>
                    {j.detail && <div className="text-[11px] text-[#5a6170]">{j.detail}</div>}
                  </td>
                  <td className="px-3 py-2 text-[#9aa1ad]">{j.schedule}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-[#9aa1ad]">{lastRun(j.lastRunAt)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{duration(j.durationMs)}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${m.dot}`} />
                      <span className={`text-xs ${m.text}`}>{m.label}</span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
