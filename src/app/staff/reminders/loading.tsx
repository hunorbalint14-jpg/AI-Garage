import { PageIntroSkeleton, BlockSkeleton, TableSkeleton } from "@/components/staff/skeletons";

// Reminders composer: due-vehicle queue panel + sent history.
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageIntroSkeleton />
      <BlockSkeleton className="h-56" />
      <TableSkeleton rows={6} cols={4} />
    </div>
  );
}
