import { BlockSkeleton, TableSkeleton } from "@/components/staff/skeletons";

export default function SupportLoading() {
  return (
    <div className="flex flex-col gap-6">
      <BlockSkeleton className="h-16 w-96 max-w-full" />
      <TableSkeleton rows={6} cols={6} />
    </div>
  );
}
