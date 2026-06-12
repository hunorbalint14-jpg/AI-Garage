import { PageIntroSkeleton, BlockSkeleton, TableSkeleton } from "@/components/staff/skeletons";

// Courtesy cars: fleet grid + open loans + history table.
export default function Loading() {
  return (
    <div className="flex flex-col gap-8">
      <PageIntroSkeleton />
      <BlockSkeleton className="h-40" />
      <BlockSkeleton className="h-32" />
      <TableSkeleton rows={5} cols={6} />
    </div>
  );
}
