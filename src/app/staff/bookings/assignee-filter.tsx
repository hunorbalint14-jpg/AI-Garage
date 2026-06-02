"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

type Staff = { id: string; name: string };

// "By technician" filter for the bookings schedule. Navigates preserving the
// other params (view/filter/month) so it composes with the existing toggles.
export function AssigneeFilter({ staff, current }: { staff: Staff[]; current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function onChange(value: string) {
    const sp = new URLSearchParams(params.toString());
    if (value) sp.set("assignee", value);
    else sp.delete("assignee");
    router.push(`${pathname}?${sp.toString()}`);
  }

  if (staff.length === 0) return null;

  return (
    <select
      value={current}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border bg-background px-3 py-1.5 text-sm"
      aria-label="Filter by technician"
    >
      <option value="">All technicians</option>
      {staff.map((s) => (
        <option key={s.id} value={s.id}>{s.name}</option>
      ))}
    </select>
  );
}
