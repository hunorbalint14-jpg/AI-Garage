"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { startTenantCheckout, openBillingPortal } from "./actions";

export function UpgradeButtons({ tier }: { tier: "pro" | "growth" }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function go(interval: "month" | "year") {
    setError(null);
    start(async () => {
      const res = await startTenantCheckout(tier, interval);
      if ("error" in res) setError(res.error);
      else window.location.href = res.url;
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => go("month")} disabled={pending}>
          {pending ? "…" : "Choose monthly"}
        </Button>
        <Button variant="outline" onClick={() => go("year")} disabled={pending}>
          {pending ? "…" : "Annual"}
        </Button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

export function ManageBillingButton() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function go() {
    setError(null);
    start(async () => {
      const res = await openBillingPortal();
      if ("error" in res) setError(res.error);
      else window.location.href = res.url;
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Button variant="outline" onClick={go} disabled={pending}>
        {pending ? "Opening…" : "Manage billing"}
      </Button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
