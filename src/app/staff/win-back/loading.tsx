import { PageIntroSkeleton, TableSkeleton } from "@/components/staff/skeletons";

// Win-back: page intro + candidates table.
export default function Loading() {
  return (
    <div className="flex flex-col gap-8">
      <PageIntroSkeleton />
      <TableSkeleton rows={6} cols={7} />
    </div>
  );
}
