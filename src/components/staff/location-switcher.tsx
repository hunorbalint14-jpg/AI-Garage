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
      <div className="mb-1 text-sm text-muted-foreground">{current?.name}</div>
    );
  }

  return (
    <div className="relative mb-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded border border-border bg-background px-2 py-1.5 text-sm hover:bg-muted"
      >
        <span className="truncate">{current?.name ?? currentSlug}</span>
        <span className="ml-1 text-muted-foreground">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded border border-border bg-background shadow-md">
          {others.map((l) => (
            <a
              key={l.id}
              href={locationUrl(l.slug)}
              className="block px-3 py-2 text-sm hover:bg-muted"
            >
              {l.name}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
