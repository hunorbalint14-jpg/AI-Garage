import Link from "next/link";
import { liveActiveMinutes, formatMinutes } from "@/lib/time-tracking";
import type { DashboardStatsV2 } from "@/lib/dashboard";
import { Plate } from "@/components/staff/workshop";

type MyDayData = NonNullable<DashboardStatsV2["my_day"]>;

const BOOKING_ACCENT: Record<string, string> = {
  scheduled: "var(--muted-foreground)",
  in_progress: "#ffb020",
  complete: "#5fdd9d",
  cancelled: "#ff5b5b",
  no_show: "#9a4a9a",
};

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

// The signed-in user's own work for today: assigned bookings, open assigned
// jobs and the running/paused clock entry. Rendered before everything else so
// technicians land on their day, not the org's.
export function MyDay({ data, now }: { data: MyDayData; now: Date }) {
  const entry = data.open_entry;
  const entryMinutes = entry
    ? liveActiveMinutes(
        {
          status: entry.status,
          active_minutes: entry.active_minutes,
          segment_started_at: entry.segment_started_at,
          duration_minutes: null,
        },
        now.toISOString(),
      )
    : 0;

  return (
    <div className="mb-5 rounded-md border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-[22px] py-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            My day
          </div>
          <div className="mt-1 text-base font-semibold text-foreground">
            {data.bookings.length} booking{data.bookings.length !== 1 ? "s" : ""} ·{" "}
            {data.jobs.length} open job{data.jobs.length !== 1 ? "s" : ""}
          </div>
        </div>
        {entry && (
          <div className="flex items-center gap-2 rounded-[2px] border border-[#3a2c14] bg-[#1c1810] px-3 py-1.5">
            <span
              className={`h-2 w-2 rounded-full ${entry.status === "running" ? "animate-pulse bg-[#ffb020]" : "bg-muted-foreground"}`}
            />
            <Link href={`/staff/jobs/${entry.job_id}`} className="font-mono text-[11px] text-[#ffb020] no-underline">
              {entry.status === "running" ? "Clocked on" : "Paused"} · {formatMinutes(entryMinutes)}
              {entry.registration ? ` · ${entry.registration}` : ""} →
            </Link>
          </div>
        )}
      </div>

      {data.bookings.length > 0 && (
        <div>
          {data.bookings.map((b, i) => (
            <Link
              key={b.id}
              href={`/staff/bookings/${b.id}`}
              className={`grid grid-cols-[auto_auto_1fr_auto] items-center gap-3 px-[22px] py-[11px] text-[13px] no-underline ${
                i > 0 ? "border-t border-border" : ""
              }`}
            >
              <span className="font-mono text-xs text-foreground">{timeLabel(b.scheduled_at)}</span>
              <span
                className="h-2.5 w-2.5 rounded-[1px]"
                style={{ background: BOOKING_ACCENT[b.status] ?? BOOKING_ACCENT.scheduled }}
              />
              <span className="min-w-0">
                {b.registration && <Plate reg={b.registration} className="mr-2" />}
                <span className="text-foreground">{b.customer_name ?? b.type.replace(/_/g, " ")}</span>
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                {b.status.replace(/_/g, " ")}
              </span>
            </Link>
          ))}
        </div>
      )}

      {data.jobs.length > 0 && (
        <div className="border-t border-border">
          <div className="px-[22px] pt-3 pb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Open jobs assigned to me
          </div>
          {data.jobs.map((j) => (
            <Link
              key={j.id}
              href={`/staff/jobs/${j.id}`}
              className="grid grid-cols-[1fr_auto] items-center gap-3 px-[22px] py-[9px] text-[13px] no-underline"
            >
              <span className="min-w-0 truncate">
                {j.registration && (
                  <span className="mr-2 font-mono text-[11px] font-bold tracking-[0.04em] text-[#f4d35e]">
                    {j.registration}
                  </span>
                )}
                <span className="text-foreground">{j.description ?? "Untitled job"}</span>
                {j.customer_name && (
                  <span className="ml-2 text-xs text-muted-foreground">{j.customer_name}</span>
                )}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                {j.status}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
