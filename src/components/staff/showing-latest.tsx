// Rendered under a list that hit its query cap, so staff know older records
// exist rather than assuming they're seeing everything.
export function ShowingLatest({ limit, entity }: { limit: number; entity: string }) {
  return (
    <p className="text-xs text-muted-foreground">
      Showing the latest {limit} {entity} — older entries exist but aren&apos;t listed here.
    </p>
  );
}
