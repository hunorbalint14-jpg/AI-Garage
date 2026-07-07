"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";

// Condensed vehicle row (UX review §1g): plate + name + ONE status chip;
// the old six-tile date grid lives behind the expander.

type Vehicle = {
  id: string;
  registration: string;
  make: string | null;
  model: string | null;
  year: number | null;
  mot_expiry: string | null;
  service_due: string | null;
  tax_due_date: string | null;
};

function dueDays(d: string | null): number | null {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000);
}

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function dueText(days: number | null): { text: string; cls: string } | null {
  if (days === null) return null;
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, cls: "text-red-400" };
  if (days <= 30) return { text: `in ${days}d`, cls: "text-red-400" };
  if (days <= 60) return { text: `in ${days}d`, cls: "text-amber-400" };
  return { text: `in ${days}d`, cls: "text-green-400" };
}

export function VehicleRow({ vehicle }: { vehicle: Vehicle }) {
  const [open, setOpen] = useState(false);
  const name = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Vehicle";

  const parts: string[] = [];
  const mot = dueDays(vehicle.mot_expiry);
  const tax = dueDays(vehicle.tax_due_date);
  const svc = dueDays(vehicle.service_due);
  if (mot !== null && mot <= 30) parts.push(mot < 0 ? "MOT overdue" : `MOT ${mot}d`);
  if (tax !== null && tax <= 30) parts.push(tax < 0 ? "tax overdue" : `tax ${tax}d`);
  if (svc !== null && svc <= 30) parts.push(svc < 0 ? "service overdue" : `service ${svc}d`);
  const urgent = parts.length > 0;

  return (
    <div className="rounded-[14px] border border-white/10 bg-white/[0.03] backdrop-blur-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="whitespace-nowrap rounded-[3px] border border-[#c9a435] bg-[#f4d35e] px-[7px] py-0.5 font-mono text-[11px] font-bold tracking-[0.06em] text-[#0e1014]">
          {vehicle.registration}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-gray-200">{name}</span>
        <span
          className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            urgent ? "bg-red-500/20 text-red-400" : "bg-green-500/20 text-green-400"
          }`}
        >
          {urgent ? parts.join(" · ") : "All good ✓"}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-gray-500 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="border-t border-white/10 px-4 pb-4 pt-3">
          <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            {(
              [
                ["MOT expiry", vehicle.mot_expiry, mot],
                ["Service due", vehicle.service_due, svc],
                ["Road tax due", vehicle.tax_due_date, tax],
              ] as const
            ).map(([label, date, days]) => {
              const due = dueText(days);
              return (
                <div key={label} className="rounded-xl bg-white/5 p-3">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">{label}</p>
                  <p className="font-semibold">{formatDate(date)}</p>
                  {due && <p className={`mt-1 text-xs font-medium ${due.cls}`}>{due.text}</p>}
                </div>
              );
            })}
          </div>
          <Link
            href={`/dashboard/mot/${vehicle.id}`}
            className="mt-3 inline-block text-xs font-semibold text-gray-400 underline transition-colors hover:text-white"
          >
            View full MOT history →
          </Link>
        </div>
      )}
    </div>
  );
}
