import { PageIntroSkeleton, BlockSkeleton } from "@/components/staff/skeletons";

// Bookings is a calendar, not a table — show a large panel placeholder.
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageIntroSkeleton />
      <BlockSkeleton className="h-[28rem]" />
    </div>
  );
}
