import { PageIntroSkeleton, BlockSkeleton, CardGridSkeleton, TableSkeleton } from "@/components/staff/skeletons";

// Revenue: five KPI cards + monthly chart + two side-by-side tables.
export default function Loading() {
  return (
    <div className="flex flex-col gap-8">
      <PageIntroSkeleton />
      <CardGridSkeleton count={5} className="grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5" />
      <BlockSkeleton className="h-72" />
      <div className="grid gap-6 sm:grid-cols-2">
        <TableSkeleton rows={5} cols={3} />
        <TableSkeleton rows={5} cols={3} />
      </div>
    </div>
  );
}
