"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// Polls server components fresh every `intervalMs` via router.refresh() (the
// admin pages are force-dynamic, so this re-runs the cross-tenant queries) and
// offers a manual Refresh. Keeps the dashboard "live" without sockets.
export function AutoRefresh({ intervalMs = 45_000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lastRefreshed, setLastRefreshed] = useState<Date>(() => new Date());

  function refresh() {
    startTransition(() => {
      router.refresh();
      setLastRefreshed(new Date());
    });
  }

  useEffect(() => {
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs]);

  return (
    <div className="flex items-center gap-3 text-xs text-[#5a6170]">
      <span suppressHydrationWarning>
        Updated {lastRefreshed.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </span>
      <button
        type="button"
        onClick={refresh}
        disabled={pending}
        className="rounded border border-[#2a2f37] px-2.5 py-1 text-[#9aa1ad] transition-colors hover:bg-white/[0.04] hover:text-white disabled:opacity-60"
      >
        {pending ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}
