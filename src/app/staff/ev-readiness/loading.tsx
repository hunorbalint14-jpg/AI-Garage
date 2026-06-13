import { PageIntroSkeleton, BlockSkeleton, TableSkeleton } from "@/components/staff/skeletons";

// EV readiness: SERMI card + quals table.
export default function Loading() {
  return (
    <div className="flex flex-col gap-8">
      <PageIntroSkeleton />
      <BlockSkeleton className="h-40" />
      <TableSkeleton rows={5} cols={6} />
    </div>
  );
}
