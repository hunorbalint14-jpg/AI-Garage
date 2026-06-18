"use client";

import { useState, useTransition } from "react";
import { MapPin, Check } from "lucide-react";
import { AigSpinner } from "@/components/ui/aig-spinner";
import { setActiveLocation } from "@/app/staff/active-location-actions";

type Branch = { id: string; slug: string; name: string };

// Full-screen branch chooser. Selecting writes the active-branch cookie (re-
// checked server-side by setActiveLocation) then enters the portal.
export function BranchSelect({
  branches,
  currentId,
  orgName,
  brandColor,
  logoUrl,
}: {
  branches: Branch[];
  currentId: string;
  orgName: string;
  brandColor: string;
  logoUrl: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function choose(id: string) {
    if (pending) return;
    setSelectedId(id);
    startTransition(async () => {
      await setActiveLocation(id);
      // Hard navigation (not router.replace): the next stop may be the AI-setup
      // gate, a shell-bypassed full-screen route. Reaching a bypassed route via
      // client RSC navigation through a server redirect renders blank; a real
      // document load renders correctly.
      window.location.assign("/staff");
    });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0e1014] px-4 py-10 text-[#e6e8eb] dark">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          {logoUrl ? (
            <div className="grid h-9 w-9 place-items-center overflow-hidden rounded bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoUrl} alt={orgName} className="h-9 w-9 object-contain" />
            </div>
          ) : (
            <div
              className="grid h-9 w-9 place-items-center rounded text-sm font-bold"
              style={{ background: brandColor, color: "#fff" }}
            >
              {orgName.charAt(0)}
            </div>
          )}
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#5a6170]">
            {orgName}
          </span>
        </div>

        <h1 className="text-2xl font-bold tracking-tight">Choose a branch</h1>
        <p className="mt-1.5 text-sm text-[#9aa1ad]">
          You have access to {branches.length} branches. Pick which one to work in — you can switch
          anytime from the menu.
        </p>

        <div className="mt-6 flex flex-col gap-2">
          {branches.map((b) => {
            const isCurrent = b.id === currentId;
            const isLoading = pending && selectedId === b.id;
            return (
              <button
                key={b.id}
                type="button"
                disabled={pending}
                onClick={() => choose(b.id)}
                className="group flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3.5 text-left transition-colors hover:bg-white/[0.07] disabled:opacity-60"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <MapPin className="h-4 w-4 shrink-0 text-[#5a6170]" />
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-semibold">{b.name}</span>
                    {isCurrent && (
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#5a6170]">
                        Default
                      </span>
                    )}
                  </span>
                </span>
                {isLoading ? (
                  <AigSpinner />
                ) : (
                  <Check
                    className="h-4 w-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-60"
                    style={{ color: brandColor }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
