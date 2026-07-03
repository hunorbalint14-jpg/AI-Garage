import { PageIntroSkeleton, BlockSkeleton } from "@/components/staff/skeletons";

// Booking detail: narrow column of stacked info sections.
export default function Loading() {
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageIntroSkeleton />
      <BlockSkeleton className="h-40" />
      <BlockSkeleton className="h-64" />
    </div>
  );
}
