"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  startStripeConnect,
  refreshStripeAccountStatus,
  openStripeDashboard,
} from "./payments-actions";

type Props = {
  hasStripeAccount: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  canManage: boolean;
};

export function PaymentsSection({
  hasStripeAccount,
  chargesEnabled,
  payoutsEnabled,
  detailsSubmitted,
  canManage,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  function handleConnect() {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const result = await startStripeConnect();
      if ("error" in result) {
        setError(result.error);
      } else {
        window.location.href = result.url;
      }
    });
  }

  function handleRefresh() {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const result = await refreshStripeAccountStatus();
      if ("error" in result) setError(result.error);
      else
        setInfo(
          result.chargesEnabled && result.payoutsEnabled
            ? "Stripe is fully active — you can accept card payments."
            : result.detailsSubmitted
            ? "Stripe details submitted; awaiting verification."
            : "Onboarding still incomplete — click Continue Stripe setup to finish.",
        );
    });
  }

  const status = !hasStripeAccount
    ? "disconnected"
    : chargesEnabled && payoutsEnabled
    ? "active"
    : detailsSubmitted
    ? "pending"
    : "incomplete";

  const badge =
    status === "active"
      ? <span className="rounded-full bg-green-500/15 text-green-700 px-2 py-0.5 text-xs font-medium">Active</span>
      : status === "pending"
      ? <span className="rounded-full bg-amber-500/15 text-amber-700 px-2 py-0.5 text-xs font-medium">Under review</span>
      : status === "incomplete"
      ? <span className="rounded-full bg-amber-500/15 text-amber-700 px-2 py-0.5 text-xs font-medium">Setup incomplete</span>
      : <span className="rounded-full bg-muted text-muted-foreground px-2 py-0.5 text-xs font-medium">Not connected</span>;

  return (
    <section className="rounded-lg border p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            Card payments {badge}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Connect Stripe to take card payments from customers via a pay-link on every invoice. Funds settle directly to your bank account. Stripe charges 1.5% + 20p per UK card transaction; AI Garage adds a small platform fee on top.
          </p>
        </div>
      </div>

      {status === "disconnected" && (
        <div>
          <Button onClick={handleConnect} disabled={!canManage || pending}>
            {pending ? "Opening Stripe…" : "Connect Stripe"}
          </Button>
          {!canManage && (
            <p className="mt-2 text-xs text-muted-foreground">
              Only owners and admins can connect a payment account.
            </p>
          )}
        </div>
      )}

      {status === "incomplete" && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleConnect} disabled={!canManage || pending}>
            {pending ? "Opening Stripe…" : "Continue Stripe setup"}
          </Button>
          <Button variant="outline" onClick={handleRefresh} disabled={pending}>
            Refresh status
          </Button>
        </div>
      )}

      {(status === "pending" || status === "active") && (
        <div className="flex flex-wrap gap-2">
          <form action={openStripeDashboard}>
            <Button type="submit" disabled={pending}>
              Open Stripe dashboard
            </Button>
          </form>
          <Button variant="outline" onClick={handleRefresh} disabled={pending}>
            Refresh status
          </Button>
        </div>
      )}

      <ul className="text-xs text-muted-foreground space-y-1 pt-1 border-t">
        <li>Charges enabled: {chargesEnabled ? "yes" : "no"}</li>
        <li>Payouts enabled: {payoutsEnabled ? "yes" : "no"}</li>
        <li>Onboarding details submitted: {detailsSubmitted ? "yes" : "no"}</li>
      </ul>

      {info && <p className="text-sm text-green-700">{info}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}
