import { PageIntroSkeleton, BlockSkeleton } from "@/components/staff/skeletons";

// Receptionist: setup card + conversation list.
export default function Loading() {
  return (
    <div className="flex flex-col gap-8">
      <PageIntroSkeleton />
      <BlockSkeleton className="h-40" />
      <BlockSkeleton className="h-64" />
    </div>
  );
}
