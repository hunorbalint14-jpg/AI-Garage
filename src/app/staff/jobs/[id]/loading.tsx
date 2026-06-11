import { BlockSkeleton } from "@/components/staff/skeletons";

// Job detail: back link + technician panel + time tracking + job detail card.
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <BlockSkeleton className="h-4 max-w-40" />
      <BlockSkeleton className="h-24" />
      <BlockSkeleton className="h-40" />
      <BlockSkeleton className="h-[28rem]" />
    </div>
  );
}
