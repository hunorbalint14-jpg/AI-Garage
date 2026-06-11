import { PageIntroSkeleton, CardGridSkeleton, TableSkeleton } from "@/components/staff/skeletons";

// Quotes: intro + three KPI cards + table.
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageIntroSkeleton />
      <CardGridSkeleton count={3} className="grid-cols-2 gap-4 sm:grid-cols-3" />
      <TableSkeleton cols={6} />
    </div>
  );
}
