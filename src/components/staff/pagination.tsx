import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

// Shared prev/next pagination footer for staff list pages. Server-rendered
// links (not buttons) so pagination works without JS and composes with any
// other query params via `extraParams`.
export function Pagination({
  page,
  pageSize,
  totalCount,
  basePath,
  extraParams = "",
}: {
  page: number;
  pageSize: number;
  totalCount: number;
  basePath: string;
  extraParams?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalCount);
  const linkClass =
    "inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-sm hover:bg-muted";
  const disabledClass =
    "inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-sm text-muted-foreground/50 pointer-events-none";
  const href = (p: number) => `${basePath}?page=${p}${extraParams ? `&${extraParams}` : ""}`;

  return (
    <div className="flex items-center justify-between">
      <p className="text-xs text-muted-foreground">
        {from}–{to} of {totalCount}
      </p>
      <div className="flex gap-2">
        <Link
          href={href(page - 1)}
          className={page > 1 ? linkClass : disabledClass}
          aria-disabled={page <= 1}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Previous
        </Link>
        <Link
          href={href(page + 1)}
          className={page < totalPages ? linkClass : disabledClass}
          aria-disabled={page >= totalPages}
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
