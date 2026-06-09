import { PageIntroSkeleton, CardGridSkeleton, BlockSkeleton } from "@/components/staff/skeletons";

// Reports is chart-heavy — intro + KPI cards + a chart panel rather than a table.
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageIntroSkeleton />
      <CardGridSkeleton count={4} />
      <BlockSkeleton className="h-72" />
    </div>
  );
}
