"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

// "All locations" vs the active branch for the finance pages. Org-wide is the
// default for owner/admin/accountant (no ?scope param); selecting the branch
// adds ?scope=branch, which the page reads to fall back to ctx.location. Other
// query params (?q, ?period) are preserved. Only rendered for org roles with
// more than one accessible branch.
export function FinanceScopeToggle({ branchName }: { branchName: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get("scope") === "branch" ? "branch" : "all";

  function href(scope: "all" | "branch") {
    const sp = new URLSearchParams(params.toString());
    if (scope === "branch") sp.set("scope", "branch");
    else sp.delete("scope");
    const qs = sp.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  const base = "rounded-md px-3 py-1 text-sm font-medium transition-colors";
  const on = "bg-background text-foreground shadow-sm";
  const off = "text-muted-foreground hover:text-foreground";

  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border bg-muted/50 p-0.5" role="group" aria-label="Finance scope">
      <Link href={href("all")} className={`${base} ${current === "all" ? on : off}`}>
        All locations
      </Link>
      <Link href={href("branch")} className={`${base} ${current === "branch" ? on : off}`}>
        {branchName}
      </Link>
    </div>
  );
}
