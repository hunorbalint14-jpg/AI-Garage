"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type MonthData = { month: string; revenue: number };

function fmt(n: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(n);
}

export function RevenueChart({ data }: { data: MonthData[] }) {
  if (data.every((d) => d.revenue === 0)) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        No paid invoices yet — revenue will appear here.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v) => fmt(v)}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
          width={64}
        />
        <Tooltip
          formatter={(value) => [fmt(Number(value)), "Revenue"]}
          contentStyle={{
            fontSize: 13,
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--card)",
            color: "var(--foreground)",
          }}
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
        />
        <Bar dataKey="revenue" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={48} />
      </BarChart>
    </ResponsiveContainer>
  );
}
