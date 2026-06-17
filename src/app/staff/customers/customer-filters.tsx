"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

type Branch = { id: string; name: string };

// Branch filter + sort controls for the customers list. Customers are org-global
// with a home branch (preferred_location_id); these let staff narrow to one
// branch and/or group the list by branch. Only rendered for multi-branch orgs.
export function CustomerFilters({
  branches,
  branch,
  sort,
}: {
  branches: Branch[];
  branch: string;
  sort: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function update(key: "branch" | "sort", value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== (key === "branch" ? "all" : "recent")) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.delete("page"); // re-filtering resets pagination
    startTransition(() => {
      router.push(`/staff/customers?${params.toString()}`);
    });
  }

  const selectClass =
    "rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
        Branch
        <select
          value={branch}
          onChange={(e) => update("branch", e.target.value)}
          disabled={pending}
          className={selectClass}
        >
          <option value="all">All branches</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
        Sort
        <select
          value={sort}
          onChange={(e) => update("sort", e.target.value)}
          disabled={pending}
          className={selectClass}
        >
          <option value="recent">Most recent</option>
          <option value="name">Name</option>
          <option value="branch">Branch</option>
        </select>
      </label>
    </div>
  );
}
