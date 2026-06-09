"use client";

import dynamic from "next/dynamic";

// Lazy boundary for the recharts bar chart. recharts is the only heavy client
// lib in the app; dynamic({ ssr: false }) splits it into its own chunk loaded
// after hydration, so it leaves the revenue route's initial JS (and the shared
// bundle). The server page imports THIS wrapper instead of revenue-chart directly.
const RevenueChartInner = dynamic(
  () => import("./revenue-chart").then((m) => m.RevenueChart),
  {
    ssr: false,
    loading: () => <div className="h-[220px] w-full animate-pulse rounded-lg bg-white/[0.04]" />,
  },
);

type MonthData = { month: string; revenue: number };

export function RevenueChart({ data }: { data: MonthData[] }) {
  return <RevenueChartInner data={data} />;
}
