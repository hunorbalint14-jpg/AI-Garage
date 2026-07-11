"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

// First-party page-view beacon (#admin/traffic PR 1). Fires once per client
// navigation via sendBeacon so it never blocks paint or unload. Deliberately
// dumb: path + initial referrer only — device/geo/identity are derived
// server-side in /api/collect from headers, and the admin host is dropped
// there too. No cookies, no localStorage, nothing persisted on the visitor.
export function TrackPageview() {
  const pathname = usePathname();
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || last.current === pathname) return; // strict-mode double fire
    last.current = pathname;
    try {
      const payload = JSON.stringify({
        path: pathname,
        // document.referrer only means "arrived from" on the first hit;
        // internal SPA navs re-send it but the server drops same-site hosts.
        ref: document.referrer || null,
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/collect", payload);
      } else {
        void fetch("/api/collect", { method: "POST", body: payload, keepalive: true });
      }
    } catch {
      // analytics must never surface an error to the visitor
    }
  }, [pathname]);

  return null;
}
