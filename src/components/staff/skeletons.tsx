// Content-area skeletons for staff route loading.tsx files. Pure server markup
// (no client JS) so they paint instantly inside the persistent staff shell — a
// navigation shows the page's shape immediately instead of a blank gap. The
// branded full-screen AigLoader is for cold boots; these are for in-shell nav.

function Bar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-white/[0.06] ${className}`} />;
}

export function PageIntroSkeleton() {
  return <Bar className="h-3.5 w-72 max-w-[60%]" />;
}

export function CardGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-[#23272f] bg-[#15181d] px-4 py-3">
          <Bar className="h-2.5 w-20" />
          <Bar className="mt-3 h-6 w-16" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#23272f]">
      <div className="flex gap-4 bg-[#15181d] px-4 py-2.5">
        {Array.from({ length: cols }).map((_, i) => (
          <Bar key={i} className="h-2.5 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 border-t border-[#23272f] px-4 py-3.5">
          {Array.from({ length: cols }).map((_, c) => (
            <Bar key={c} className="h-3 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

// A big rounded panel — calendar grids, charts, editors.
export function BlockSkeleton({ className = "h-80" }: { className?: string }) {
  return <Bar className={`w-full ${className}`} />;
}

// Default list-page shape (intro line + table). Cascades to every staff route
// that doesn't ship its own loading.tsx.
export function ListPageSkeleton({ cols = 5 }: { cols?: number }) {
  return (
    <div className="flex flex-col gap-6">
      <PageIntroSkeleton />
      <TableSkeleton cols={cols} />
    </div>
  );
}
