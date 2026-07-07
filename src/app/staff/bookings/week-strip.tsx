import Link from "next/link";

// Week strip (UX review §1d): 7 cells for orientation — per-day booking
// count + a 3px utilisation bar. Clicking a cell selects that day for the
// timeline below. Replaces the month grid as the default way to look around.

export type WeekDay = {
  date: string; // YYYY-MM-DD
  weekdayShort: string; // MON
  dayNum: number;
  count: number;
  utilisation: number; // 0..1
  open: boolean;
  isToday: boolean;
  selected: boolean;
  href: string;
};

export function WeekStrip({ days }: { days: WeekDay[] }) {
  return (
    <div className="grid grid-cols-7 gap-1.5">
      {days.map((d) => (
        <Link
          key={d.date}
          href={d.href}
          aria-current={d.selected ? "date" : undefined}
          className={`flex flex-col gap-1 rounded-[4px] border px-2.5 py-2 no-underline transition-colors ${
            d.selected
              ? "border-ws-amber bg-[#1c1810]"
              : d.isToday
                ? "border-ws-amber-border bg-[#1c1810] hover:border-ws-amber"
                : d.open
                  ? "border-ws-border bg-ws-card hover:border-[#3a4049]"
                  : "border-ws-border bg-ws-page opacity-50"
          }`}
        >
          <span
            className={`font-mono text-[9px] uppercase tracking-[0.08em] ${
              d.isToday || d.selected ? "text-ws-amber" : "text-ws-text-3"
            }`}
          >
            {d.weekdayShort} {d.dayNum}
          </span>
          <span className="font-mono text-[15px] font-semibold leading-none text-ws-text">
            {d.open ? d.count : <span className="text-[10px] font-normal text-ws-text-3">closed</span>}
          </span>
          <span className="h-[3px] w-full overflow-hidden rounded-full bg-ws-hover" aria-hidden>
            {d.open && (
              <span
                className={`block h-full ${d.isToday ? "bg-ws-amber" : "bg-ws-green"}`}
                style={{ width: `${Math.round(Math.min(1, d.utilisation) * 100)}%` }}
              />
            )}
          </span>
        </Link>
      ))}
    </div>
  );
}
