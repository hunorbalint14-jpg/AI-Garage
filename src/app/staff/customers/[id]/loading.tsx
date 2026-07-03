import { PageIntroSkeleton, BlockSkeleton, TableSkeleton } from "@/components/staff/skeletons";

// Customer detail: heading + detail cards (customer / vehicle info), then the
// history table. Heaviest page in the app, so the shape matters most here.
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageIntroSkeleton />
      <div className="grid gap-4 lg:grid-cols-2">
        <BlockSkeleton className="h-44" />
        <BlockSkeleton className="h-44" />
      </div>
      <TableSkeleton cols={5} rows={6} />
    </div>
  );
}
