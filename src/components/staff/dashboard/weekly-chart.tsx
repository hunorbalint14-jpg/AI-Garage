import { fmtGBP } from "@/lib/dashboard";

export function WeeklyChart({
  days,
}: {
  days: { label: string; revenue: number; isToday: boolean; isFuture: boolean }[];
}) {
  const maxRev = Math.max(...days.map((d) => d.revenue), 1);
  const chartH = 120;
  const barW = 30;
  const gap = 10;
  const totalW = days.length * (barW + gap) - gap;
  return (
    <svg viewBox={`0 0 ${totalW} ${chartH + 28}`} className="w-full overflow-visible">
      {days.map((day, i) => {
        const barH = Math.max(day.isFuture ? 2 : (day.revenue / maxRev) * chartH, day.revenue > 0 ? 4 : 2);
        const x = i * (barW + gap);
        const y = chartH - barH;
        const fill = day.isToday ? "#f4d35e" : day.isFuture ? "var(--muted)" : "var(--border)";
        return (
          <g key={day.label}>
            {!day.isFuture && day.revenue > 0 && (
              <text
                x={x + barW / 2}
                y={y - 4}
                textAnchor="middle"
                className="fill-muted-foreground font-mono text-[8px]"
              >
                {fmtGBP(day.revenue)}
              </text>
            )}
            <rect x={x} y={y} width={barW} height={barH} fill={fill} rx={2} />
            <text
              x={x + barW / 2}
              y={chartH + 16}
              textAnchor="middle"
              className={`font-mono text-[10px] ${day.isToday ? "fill-foreground font-semibold" : "fill-muted-foreground"}`}
            >
              {day.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
