import { PageIntroSkeleton, CardGridSkeleton, TableSkeleton } from "@/components/staff/skeletons";

// Campaigns: intro + audience/template cards + send history.
export default function Loading() {
  return (
    <div className="flex flex-col gap-8">
      <PageIntroSkeleton />
      <CardGridSkeleton count={5} className="grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" />
      <TableSkeleton rows={6} cols={4} />
    </div>
  );
}
