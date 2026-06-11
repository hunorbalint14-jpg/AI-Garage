import { PageIntroSkeleton, BlockSkeleton, TableSkeleton } from "@/components/staff/skeletons";

// Customers: intro + search toolbar + paginated table.
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageIntroSkeleton />
      <BlockSkeleton className="h-9 max-w-md" />
      <TableSkeleton cols={5} />
    </div>
  );
}
