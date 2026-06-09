"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";

export type CustomerListRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
  registrations: string[];
};

// Clickable customer list. Whole row (desktop) / card (mobile) navigates to the
// customer detail page — the old layout only offered a small "View" link at the
// far right. Edit stays a discrete link and stops propagation.
export function CustomerTable({ rows }: { rows: CustomerListRow[] }) {
  const router = useRouter();
  const go = (id: string) => router.push(`/staff/customers/${id}`);

  return (
    <>
      {/* Desktop table (sm and up) */}
      <div className="hidden sm:block overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Vehicles</th>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Phone</th>
              <th className="px-4 py-2 font-medium">Added</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr
                key={c.id}
                onClick={() => go(c.id)}
                className="border-t cursor-pointer transition-colors hover:bg-muted/40"
              >
                <td className="px-4 py-2.5 font-medium">{c.full_name ?? "—"}</td>
                <td className="px-4 py-2.5">
                  <RegBadges regs={c.registrations} />
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{c.email ?? "—"}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{c.phone ?? "—"}</td>
                <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                  {new Date(c.created_at).toLocaleDateString("en-GB")}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link
                    href={`/staff/customers/${c.id}/edit`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-sm underline text-muted-foreground hover:text-foreground"
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards (below sm) */}
      <ul className="sm:hidden flex flex-col gap-2">
        {rows.map((c) => (
          <li key={c.id}>
            <button
              onClick={() => go(c.id)}
              className="w-full rounded-lg border bg-card p-3 text-left transition-colors active:bg-muted/40"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium">{c.full_name ?? "—"}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Date(c.created_at).toLocaleDateString("en-GB")}
                </span>
              </div>
              <div className="mt-1.5">
                <RegBadges regs={c.registrations} />
              </div>
              <div className="mt-1.5 flex flex-col gap-0.5 text-xs text-muted-foreground">
                {c.phone && <span>{c.phone}</span>}
                {c.email && <span className="truncate">{c.email}</span>}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function RegBadges({ regs }: { regs: string[] }) {
  if (regs.length === 0) return <span className="text-muted-foreground">—</span>;
  const shown = regs.slice(0, 3);
  const extra = regs.length - shown.length;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((r) => (
        <span
          key={r}
          className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-medium"
        >
          {r}
        </span>
      ))}
      {extra > 0 && (
        <span className="text-xs text-muted-foreground">+{extra} more</span>
      )}
    </span>
  );
}
