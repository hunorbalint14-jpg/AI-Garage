import type { WebhookHealth } from "@/lib/platform/webhooks";

function rateTone(pct: number): string {
  return pct >= 99.5 ? "text-[#5fdd9d]" : pct >= 97 ? "text-[#f5c451]" : "text-[#ff7b7b]";
}
function dotTone(pct: number): string {
  return pct >= 99.5 ? "bg-[#5fdd9d]" : pct >= 97 ? "bg-[#f5c451]" : "bg-[#ff7b7b]";
}

export function WebhooksPanel({ webhooks }: { webhooks: WebhookHealth[] }) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Webhook delivery</h2>
        <span className="text-[11px] text-[#5a6170]">inbound from providers · last 24h</span>
      </div>
      {webhooks.length === 0 ? (
        <div className="rounded-xl border border-[#23272f] bg-[#15181d] px-4 py-6 text-center text-sm text-[#5a6170]">
          No webhook deliveries recorded in the last 24h.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {webhooks.map((w) => (
            <div key={w.provider} className="rounded-xl border border-[#23272f] bg-[#15181d] px-3.5 py-3">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${dotTone(w.successPct)}`} />
                <span className="font-semibold capitalize">{w.provider}</span>
                <span className={`ml-auto font-mono text-sm font-semibold ${rateTone(w.successPct)}`}>{w.successPct}%</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 font-mono text-[11.5px] text-[#9aa1ad]">
                <span>{w.delivered.toLocaleString("en-GB")} delivered</span>
                <span className={w.failed > 0 ? "text-[#ff7b7b]" : ""}>{w.failed} failed</span>
                {w.p95Ms != null && <span>{w.p95Ms}ms p95</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
