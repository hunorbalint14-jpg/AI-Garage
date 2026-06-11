import { PageIntroSkeleton, BlockSkeleton, CardGridSkeleton, TableSkeleton } from "@/components/staff/skeletons";

// Invoices: intro + search + three money KPI cards + table.
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageIntroSkeleton />
      <BlockSkeleton className="h-9 max-w-md" />
      <CardGridSkeleton count={3} className="grid-cols-2 gap-4 sm:grid-cols-3" />
      <TableSkeleton cols={6} />
    </div>
  );
}
