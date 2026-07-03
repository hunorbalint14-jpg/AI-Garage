import { PageIntroSkeleton, BlockSkeleton, TableSkeleton } from "@/components/staff/skeletons";

// Quote detail: summary header, line items table, actions/history below.
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageIntroSkeleton />
      <BlockSkeleton className="h-32" />
      <TableSkeleton cols={4} rows={5} />
    </div>
  );
}
