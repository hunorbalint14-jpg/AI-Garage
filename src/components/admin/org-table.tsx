"use client";

import { useState } from "react";
import Link from "next/link";

export type AdminOrgRow = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  billing: "active" | "trialing" | "lapsed" | "free";
  locations: number;
  staff: number;
  customers: number;
  invoices: number;
  revenuePence: number;
  mrrPence: number;
  aiCostPence30d: number;
  stripe: boolean;
  xero: boolean;
  lastActivity: string | null;
};

type SortKey =
  | "name" | "plan" | "billing" | "locations" | "staff" | "customers"
  | "invoices" | "revenuePence" | "mrrPence" | "aiCostPence30d" | "lastActivity";

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 });
function money(pence: number): string {
  return gbp.format(pence / 100);
}

const BILLING_STYLE: Record<AdminOrgRow["billing"], string> = {
  active: "bg-[#13301f] text-[#5fdd9d] border-[#2a5a3a]",
  trialing: "bg-[#1c2740] text-[#7aa2ff] border-[#2c3c63]",
  lapsed: "bg-[#3a1a1a] text-[#ff7b7b] border-[#5a2424]",
  free: "bg-[#23272f] text-[#9aa1ad] border-[#2a2f37]",
};

// Module-level so it isn't re-created each render.
function SortHeader({
  k, label, right, sortKey, dir, onToggle,
}: {
  k: SortKey;
  label: string;
  right?: boolean;
  sortKey: SortKey;
  dir: "asc" | "desc";
  onToggle: (k: SortKey) => void;
}) {
  return (
    <th className={`whitespace-nowrap px-3 py-2 font-medium ${right ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onToggle(k)}
        className={`inline-flex items-center gap-1 hover:text-white ${sortKey === k ? "text-white" : ""}`}
      >
        {label}
        {sortKey === k && <span className="text-[#5a6170]">{dir === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  );
}

export function OrgTable({ rows }: { rows: AdminOrgRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("mrrPence");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  function toggle(key: SortKey) {
    if (key === sortKey) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setDir(key === "name" ? "asc" : "desc");
    }
  }

  const sorted = [...rows].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    let cmp: number;
    if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
    else cmp = String(av ?? "").localeCompare(String(bv ?? ""));
    return dir === "asc" ? cmp : -cmp;
  });

  const headerProps = { sortKey, dir, onToggle: toggle };

  return (
    <div className="overflow-x-auto rounded-xl border border-[#23272f]">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-[#15181d] text-xs text-[#9aa1ad]">
          <tr>
            <SortHeader k="name" label="Organisation" {...headerProps} />
            <SortHeader k="plan" label="Plan" {...headerProps} />
            <SortHeader k="billing" label="Status" {...headerProps} />
            <SortHeader k="locations" label="Loc" right {...headerProps} />
            <SortHeader k="staff" label="Staff" right {...headerProps} />
            <SortHeader k="customers" label="Customers" right {...headerProps} />
            <SortHeader k="invoices" label="Invoices" right {...headerProps} />
            <SortHeader k="revenuePence" label="Revenue" right {...headerProps} />
            <SortHeader k="mrrPence" label="MRR" right {...headerProps} />
            <SortHeader k="aiCostPence30d" label="AI 30d" right {...headerProps} />
            <th className="px-3 py-2 text-center font-medium">Integr.</th>
            <SortHeader k="lastActivity" label="Last activity" right {...headerProps} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id} className="border-t border-[#23272f] hover:bg-white/[0.02]">
              <td className="px-3 py-2">
                <Link href={`/admin/orgs/${r.id}`} className="font-medium text-white hover:underline">
                  {r.name}
                </Link>
                <div className="font-mono text-[10px] text-[#5a6170]">{r.slug}</div>
              </td>
              <td className="px-3 py-2 text-[#c7ccd4]">{r.plan}</td>
              <td className="px-3 py-2">
                <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase ${BILLING_STYLE[r.billing]}`}>
                  {r.billing}
                </span>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{r.locations}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.staff}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.customers}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.invoices}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(r.revenuePence)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(r.mrrPence)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(r.aiCostPence30d)}</td>
              <td className="px-3 py-2 text-center font-mono text-[10px]">
                <span className={r.stripe ? "text-[#5fdd9d]" : "text-[#3a3f47]"} title="Stripe">S</span>
                {" · "}
                <span className={r.xero ? "text-[#5fdd9d]" : "text-[#3a3f47]"} title="Xero">X</span>
              </td>
              <td className="px-3 py-2 text-right text-xs text-[#9aa1ad]">
                {r.lastActivity ? new Date(r.lastActivity).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—"}
              </td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={12} className="px-3 py-8 text-center text-sm text-[#5a6170]">
                No organisations yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
