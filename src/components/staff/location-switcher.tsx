"use client";

import { useState } from "react";

type Location = { id: string; slug: string; name: string };

const ROOT = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localtest.me:3000";
const ROOT_HOST = ROOT.split(":")[0];

function locationUrl(slug: string) {
  const protocol =
    typeof window !== "undefined" ? window.location.protocol : "http:";
  const port = ROOT.includes(":") ? `:${ROOT.split(":")[1]}` : "";
  return `${protocol}//${slug}.${ROOT_HOST}${port}/staff`;
}

export function LocationSwitcher({
  locations,
  currentSlug,
}: {
  locations: Location[];
  currentSlug: string;
}) {
  const [open, setOpen] = useState(false);
  const current = locations.find((l) => l.slug === currentSlug);
  const others = locations.filter((l) => l.slug !== currentSlug);

  if (locations.length <= 1) {
    return (
      <p className="px-1 text-sm text-gray-400">{current?.name ?? currentSlug}</p>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
      >
        <span className="truncate">{current?.name ?? currentSlug}</span>
        <span className="ml-1 text-gray-500">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-white/10 bg-[#0a1020] shadow-xl">
          {others.map((l) => (
            <a
              key={l.id}
              href={locationUrl(l.slug)}
              className="block px-3 py-2 text-sm text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
            >
              {l.name}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
