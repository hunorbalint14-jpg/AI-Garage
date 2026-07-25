"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setActiveLocation } from "@/app/staff/active-location-actions";
import { isPrelive, PRELIVE_BADGE_LABEL } from "@/lib/prelive";

// Marks a branch that isn't live yet, so an owner running several sites can see
// at a glance which ones are still silenced (#585).
function PreliveDot() {
  return (
    <span className="ml-1.5 rounded-[2px] border border-ws-blue-border bg-ws-blue-bg px-1 py-px font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-ws-blue">
      {PRELIVE_BADGE_LABEL}
    </span>
  );
}

type Location = { id: string; slug: string; name: string; live_at: string | null };

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
    : "border border-ws-border bg-ws-card text-ws-text-2 hover:bg-ws-hover";
  const dropdownCls = dark
    ? "border border-white/10 bg-[#0a1020] shadow-xl"
    : "border border-ws-border bg-ws-card shadow-md";
  const dropItemCls = dark
    ? "text-gray-300 hover:bg-white/10 hover:text-white"
    : "text-ws-text-2 hover:bg-ws-hover hover:text-ws-text";

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
        {/* Chip sits OUTSIDE the truncating span — a long branch name must not
            clip the one badge that says nothing is being sent. */}
        <span className="flex min-w-0 items-center">
          <span className="truncate">{current?.name ?? "Select branch"}</span>
          {current && isPrelive(current) && <PreliveDot />}
        </span>
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
              {isPrelive(l) && <PreliveDot />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
