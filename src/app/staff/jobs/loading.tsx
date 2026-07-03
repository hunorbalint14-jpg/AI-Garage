import { PageIntroSkeleton, BlockSkeleton } from "@/components/staff/skeletons";

// Jobs board: three status columns, not a table — override the cascaded
// list-page default with the board shape.
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageIntroSkeleton />
      <div className="grid gap-4 lg:grid-cols-3">
        <BlockSkeleton className="h-96" />
        <BlockSkeleton className="h-96" />
        <BlockSkeleton className="h-96" />
      </div>
    </div>
  );
}
