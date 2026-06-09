import type { SentryIssue } from "@/lib/platform/sentry";

function ago(iso: string | null): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}

function fmtNum(n: number | null): string {
  if (n == null) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

const DOT: Record<string, string> = {
  error: "bg-[#ff7b7b]",
  fatal: "bg-[#ff7b7b]",
  warning: "bg-[#f5c451]",
};

export function IssuesPanel({
  issues,
  events24h,
  configured,
}: {
  issues: SentryIssue[];
  events24h: number | null;
  configured: boolean;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Top issues</h2>
        <span className="text-[11px] text-[#5a6170]">
          Sentry · last 24h{events24h != null ? ` · ${fmtNum(events24h)} events` : ""}
        </span>
      </div>
      <div className="overflow-hidden rounded-xl border border-[#23272f] bg-[#15181d]">
        {issues.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-[#5a6170]">
            {configured
              ? "No unresolved issues in the last 24h. The uptime cron refreshes this from Sentry."
              : "Set SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT to pull issues from Sentry."}
          </div>
        ) : (
          issues.map((iss) => (
            <div key={iss.rank} className="flex items-start gap-3 border-t border-[#23272f] px-4 py-3 first:border-t-0">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[iss.level ?? ""] ?? "bg-[#5a6170]"}`} />
              <div className="min-w-0 flex-1">
                {iss.permalink ? (
                  <a href={iss.permalink} target="_blank" rel="noreferrer" className="block truncate font-mono text-[12.5px] text-[#e6e8eb] hover:text-[#7aa2ff]">
                    {iss.title}
                  </a>
                ) : (
                  <div className="truncate font-mono text-[12.5px] text-[#e6e8eb]">{iss.title}</div>
                )}
                {iss.culprit && <div className="truncate font-mono text-[10.5px] text-[#5a6170]">{iss.culprit}</div>}
              </div>
              <div className="shrink-0 text-right">
                <div className="font-mono text-sm tabular-nums text-[#e6e8eb]">
                  {fmtNum(iss.events)}
                  <span className="ml-1 text-[10px] text-[#5a6170]">events</span>
                </div>
                <div className="text-[10.5px] text-[#9aa1ad]">
                  {iss.users != null ? `${fmtNum(iss.users)} users` : "—"} · {ago(iss.lastSeen)}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
