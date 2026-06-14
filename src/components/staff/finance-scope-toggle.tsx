"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

// Finance scope picker for owner/admin/accountant: "All locations" (the org-wide
// roll-up, the default) plus every accessible branch. Selecting a branch adds
// ?scope=<locationId>, which the page reads to scope its queries to that branch;
// "All locations" clears it. Other query params (?q, ?period) are preserved.
// Only rendered for org roles with more than one accessible branch; location
// staff never see it and stay scoped to their own branch.
export function FinanceScopeToggle({ locations }: { locations: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get("scope") ?? "all";

  function onChange(value: string) {
    const sp = new URLSearchParams(params.toString());
    if (value === "all") sp.delete("scope");
    else sp.set("scope", value);
    const qs = sp.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <select
      value={current}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border bg-background px-3 py-1.5 text-sm"
      aria-label="Finance scope"
    >
      <option value="all">All locations</option>
      {locations.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name}
        </option>
      ))}
    </select>
  );
}
