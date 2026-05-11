import { Skeleton } from "@/components/staff/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div>
        <Skeleton className="h-7 w-40 mb-2" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-32" />
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-20 rounded-lg" />
      </div>
    </div>
  );
}
