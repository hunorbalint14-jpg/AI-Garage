"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setActiveLocation } from "@/app/staff/active-location-actions";

type Location = { id: string; slug: string; name: string };

// The subdomain is the ORGANISATION; the active branch is a cookie. Switching
// posts the chosen location id to setActiveLocation (which re-checks membership)
// then refreshes so server components re-read the new operational scope.
export function LocationSwitcher({
  locations,
  currentId,
  dark = true,
}: {
  locations: Location[];
  currentId: string;
  dark?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const current = locations.find((l) => l.id === currentId);
  const others = locations.filter((l) => l.id !== currentId);

  const textCls = dark ? "text-gray-400" : "text-gray-500";
  const btnCls = dark
    ? "border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white"
    : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50";
  const dropdownCls = dark
    ? "border border-white/10 bg-[#0a1020] shadow-xl"
    : "border border-gray-200 bg-white shadow-md";
  const dropItemCls = dark
    ? "text-gray-300 hover:bg-white/10 hover:text-white"
    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900";

  if (locations.length <= 1) {
    return <p className={`px-1 text-sm ${textCls}`}>{current?.name ?? "—"}</p>;
  }

  function switchTo(id: string) {
    setOpen(false);
    startTransition(async () => {
      await setActiveLocation(id);
      router.refresh();
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        disabled={pending}
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-sm transition-colors disabled:opacity-50 ${btnCls}`}
      >
        <span className="truncate">{current?.name ?? "Select branch"}</span>
        <span className="ml-1 opacity-50">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className={`absolute left-0 right-0 top-full z-20 mt-1 rounded-lg ${dropdownCls}`}>
          {others.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => switchTo(l.id)}
              className={`block w-full px-3 py-2 text-left text-sm transition-colors ${dropItemCls}`}
            >
              {l.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
