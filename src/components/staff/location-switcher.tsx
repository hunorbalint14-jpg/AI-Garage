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
  dark = true,
}: {
  locations: Location[];
  currentSlug: string;
  dark?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = locations.find((l) => l.slug === currentSlug);
  const others = locations.filter((l) => l.slug !== currentSlug);

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
    return (
      <p className={`px-1 text-sm ${textCls}`}>{current?.name ?? currentSlug}</p>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-sm transition-colors ${btnCls}`}
      >
        <span className="truncate">{current?.name ?? currentSlug}</span>
        <span className="ml-1 opacity-50">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className={`absolute left-0 right-0 top-full z-20 mt-1 rounded-lg ${dropdownCls}`}>
          {others.map((l) => (
            <a
              key={l.id}
              href={locationUrl(l.slug)}
              className={`block px-3 py-2 text-sm transition-colors ${dropItemCls}`}
            >
              {l.name}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
