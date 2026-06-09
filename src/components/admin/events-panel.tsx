import type { EventSeverity, EventSource, PlatformEvent } from "@/lib/platform/events";

const DOT: Record<EventSeverity, string> = {
  success: "bg-[#5fdd9d]",
  info: "bg-[#7aa2ff]",
  warn: "bg-[#f5c451]",
  error: "bg-[#ff7b7b]",
};

const SRC_TEXT: Record<EventSource, string> = {
  cron: "text-[#9aa1ad]",
  webhook: "text-[#9aa1ad]",
  incident: "text-[#ff9b9b]",
  alert: "text-[#f5c451]",
};

function clock(iso: string): string {
  const d = new Date(iso);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function EventsPanel({ events }: { events: PlatformEvent[] }) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Live events</h2>
        <span className="text-[11px] text-[#5a6170]">cron · webhooks · incidents · alerts · last 24h</span>
      </div>
      <div className="overflow-hidden rounded-xl border border-[#23272f] bg-[#15181d]">
        {events.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-[#5a6170]">
            No activity in the last 24h. Cron runs, webhook deliveries, incident updates and alert fires land here as they happen.
          </div>
        ) : (
          events.map((e) => (
            <div key={e.id} className="flex items-center gap-3 border-t border-[#23272f] px-4 py-2 first:border-t-0">
              <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-[#5a6170]">{clock(e.at)}</span>
              <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[e.severity]}`} />
              <span className={`w-16 shrink-0 font-mono text-[10.5px] uppercase tracking-wide ${SRC_TEXT[e.source]}`}>{e.source}</span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-[#c7ccd4]">{e.message}</span>
              {e.tenant && <span className="shrink-0 font-mono text-[10.5px] text-[#5a6170]">{e.tenant}</span>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
