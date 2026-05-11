import { Skeleton } from "@/components/staff/skeleton";

export default function Loading() {
  return (
    <div style={{ display: "flex", height: "calc(100vh - 64px)", gap: 0 }}>
      <div style={{ width: 260, borderRight: "1px solid #2a2f37", padding: 16 }}>
        <Skeleton className="h-4 w-24 mb-3" />
        <Skeleton className="h-5 w-40 mb-2" />
        <Skeleton className="h-4 w-32 mb-6" />
        {[...Array(6)].map((_, i) => (
          <Skeleton key={i} className="h-16 mb-2 rounded-md" />
        ))}
      </div>
      <div style={{ flex: 1, padding: 24 }}>
        <Skeleton className="h-6 w-48 mb-4" />
        <Skeleton className="h-4 w-64 mb-8" />
        <Skeleton className="h-40 mb-4 rounded-md" />
        <Skeleton className="h-40 rounded-md" />
      </div>
      <div style={{ width: 280, borderLeft: "1px solid #2a2f37", padding: 16 }}>
        <Skeleton className="h-4 w-24 mb-3" />
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-12 mb-2 rounded-md" />
        ))}
      </div>
    </div>
  );
}
