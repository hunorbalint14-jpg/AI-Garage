"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AigSpinner } from "@/components/ui/aig-spinner";
import { updateLocationSlug } from "./actions";

const ROOT = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "").split(":")[0];

type Loc = { id: string; name: string; slug: string };

function LocationRow({ loc }: { loc: Loc }) {
  const router = useRouter();
  const [slug, setSlug] = useState(loc.slug);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = slug.trim().toLowerCase() !== loc.slug;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setMsg(null);
    const fd = new FormData();
    fd.set("locationId", loc.id);
    fd.set("slug", slug);
    const result = await updateLocationSlug(fd);
    setPending(false);
    if ("error" in result) {
      setMsg({ ok: false, text: result.error });
      return;
    }
    setMsg({ ok: true, text: "Updated. The new address is live." });
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-[#23272f] bg-[#15181d] p-3">
      <div className="mb-2 text-sm font-medium text-white">{loc.name}</div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          spellCheck={false}
          autoCapitalize="none"
          className="w-44 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-sm text-white focus:border-white/30 focus:outline-none"
        />
        {ROOT && <span className="font-mono text-xs text-[#5a6170]">.{ROOT}</span>}
        <button
          type="submit"
          disabled={!dirty || pending}
          className="inline-flex items-center gap-2 rounded-lg border border-[#2a2f37] px-3 py-1.5 text-xs font-semibold text-[#e6e8eb] transition-colors hover:bg-white/[0.04] disabled:opacity-50"
        >
          {pending && <AigSpinner />}
          Save
        </button>
        {msg && <span className={`text-xs ${msg.ok ? "text-[#5fdd9d]" : "text-red-400"}`}>{msg.text}</span>}
      </div>
    </form>
  );
}

export function LocationSlugEditor({ locations }: { locations: Loc[] }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-lg border border-[#4a3a13] bg-[#2a2110] px-3 py-2 text-xs text-[#e8c97a]">
        ⚠ Changing a slug changes the garage&apos;s web address (subdomain). Existing links, bookmarks, and
        already-sent email links stop resolving — the old address is not redirected. Do this only on the client&apos;s
        request.
      </p>
      {locations.map((loc) => (
        <LocationRow key={loc.id} loc={loc} />
      ))}
      {locations.length === 0 && <p className="text-sm text-[#5a6170]">No locations.</p>}
    </div>
  );
}
