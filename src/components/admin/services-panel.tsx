import type { ServiceCard, Slo, TelemetrySource, Tone } from "@/lib/platform/services";

const DOT: Record<Tone | "pending", string> = {
  operational: "bg-[#5fdd9d]",
  degraded: "bg-[#f5c451]",
  down: "bg-[#ff7b7b]",
  pending: "bg-[#5a6170]",
};
const BORDER: Record<Tone, string> = {
  operational: "border-[#23272f]",
  degraded: "border-[#5a4a1f]",
  down: "border-[#5a2424]",
};

function ago(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 90) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 90 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
}

function budgetTone(pct: number | null): string {
  if (pct == null) return "bg-[#5a6170]";
  return pct > 50 ? "bg-[#5fdd9d]" : pct > 15 ? "bg-[#f5c451]" : "bg-[#ff7b7b]";
}

export function ServicesPanel({
  telemetry,
  services,
  slos,
}: {
  telemetry: TelemetrySource[];
  services: ServiceCard[];
  slos: Slo[];
}) {
  const degraded = services.filter((s) => s.status !== "operational").length;

  return (
    <div className="flex flex-col gap-4">
      {/* Telemetry sources */}
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Telemetry sources</h2>
          <span className="text-[11px] text-[#5a6170]">where this data comes from</span>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {telemetry.map((s) => (
            <div key={s.name} className={`rounded-xl border bg-[#15181d] px-3.5 py-3 ${s.status === "pending" ? "border-[#23272f] opacity-70" : BORDER[s.status]}`}>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${DOT[s.status]}`} />
                <span className="text-[13px] font-semibold">{s.name}</span>
                <span className="ml-auto font-mono text-[10.5px] text-[#5a6170]">{s.last}</span>
              </div>
              <div className="mt-1 font-mono text-[10.5px] text-[#5a6170]">{s.detail}</div>
              <div className="text-[11px] text-[#9aa1ad]">
                feeds <span className="text-[#c7ccd4]">{s.feeds}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Platform services */}
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Platform services</h2>
          <span className="text-[11px] text-[#5a6170]">{degraded} of {services.length} not operational</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {services.map((s) => (
            <div key={s.key} className={`rounded-xl border bg-[#15181d] px-3.5 py-3 ${BORDER[s.status]}`}>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${DOT[s.status]}`} />
                <span className="text-[13.5px] font-semibold">{s.name}</span>
                <span className="ml-auto font-mono text-[10px] text-[#5a6170]">{s.vendor}</span>
              </div>
              <div className="mt-2 flex items-end justify-between">
                <div>
                  <div className="text-[9.5px] uppercase tracking-wide text-[#5a6170]">latency</div>
                  <div className="font-mono text-sm text-[#e6e8eb]">{s.latencyMs != null ? `${s.latencyMs}ms` : "—"}</div>
                </div>
                <div className="text-right">
                  <div className="text-[9.5px] uppercase tracking-wide text-[#5a6170]">checked</div>
                  <div className="font-mono text-[11px] text-[#9aa1ad]">{ago(s.lastCheckedAt)}</div>
                </div>
              </div>
              <div className="mt-1 font-mono text-[10.5px] text-[#5a6170]">{s.detail}</div>
            </div>
          ))}
        </div>
      </div>

      {/* SLO budgets */}
      <div>
        <h2 className="mb-2 text-sm font-semibold">Service level objectives</h2>
        <div className="rounded-xl border border-[#23272f] bg-[#15181d] px-4 py-1">
          {slos.map((slo) => {
            const ok = slo.current != null && slo.current >= slo.target;
            return (
              <div key={slo.name} className="grid grid-cols-[minmax(0,1.4fr)_2fr] items-center gap-4 border-t border-[#23272f] py-3 first:border-t-0">
                <div>
                  <div className="text-[13px] font-medium">{slo.name}</div>
                  <div className="font-mono text-[11px] text-[#5a6170]">target {slo.target}% · {slo.window}</div>
                </div>
                <div className="flex items-center gap-3.5">
                  <div className="h-2 flex-1 overflow-hidden rounded border border-[#23272f] bg-[#171b21]">
                    <div className={`h-full rounded ${budgetTone(slo.budgetPct)}`} style={{ width: `${Math.max(2, slo.budgetPct ?? 0)}%` }} />
                  </div>
                  <div className="flex min-w-[66px] flex-col items-end">
                    <span className={`font-mono text-sm font-semibold ${slo.current == null ? "text-[#5a6170]" : ok ? "text-[#5fdd9d]" : "text-[#ff7b7b]"}`}>
                      {slo.current != null ? `${slo.current}%` : "—"}
                    </span>
                    <span className="font-mono text-[10px] text-[#5a6170]">
                      budget {slo.budgetPct != null ? `${Math.round(slo.budgetPct)}%` : "—"}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
