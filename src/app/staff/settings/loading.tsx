import { PageIntroSkeleton, BlockSkeleton } from "@/components/staff/skeletons";

// Settings (all tabs — this segment also covers billing and team-roles):
// intro, tab bar, then a narrower form column.
export default function Loading() {
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageIntroSkeleton />
      <BlockSkeleton className="h-9 max-w-xl" />
      <div className="flex max-w-2xl flex-col gap-6">
        <BlockSkeleton className="h-48" />
        <BlockSkeleton className="h-48" />
      </div>
    </div>
  );
}
