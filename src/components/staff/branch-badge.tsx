// Small pill for a customer's home garage (preferred branch) or a record's
// servicing branch. Render only for multi-location orgs — callers gate on
// ctx.accessibleLocations.length > 1 so single-location orgs stay uncluttered.
export function BranchBadge({ name, className = "" }: { name: string | null | undefined; className?: string }) {
  if (!name) return null;
  return (
    <span
      className={`inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300 ${className}`}
    >
      {name}
    </span>
  );
}
