"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { disconnectXero } from "./xero-actions";

type Props = {
  connected: boolean;
  tenantName: string | null;
  connectedAt: string | null;
  canManage: boolean;
};

export function XeroSection({ connected, tenantName, connectedAt, canManage }: Props) {
  const [pending, startTransition] = useTransition();

  function handleConnect() {
    window.location.href = "/api/xero/connect/begin";
  }

  function handleDisconnect() {
    if (!confirm("Disconnect Xero? New invoices will stop syncing.")) return;
    startTransition(async () => {
      await disconnectXero();
      window.location.reload();
    });
  }

  return (
    <section className="rounded-lg border p-5 flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          Xero accounting
          {connected ? (
            <span className="rounded-full bg-green-500/15 text-green-700 px-2 py-0.5 text-xs font-medium">
              Connected
            </span>
          ) : (
            <span className="rounded-full bg-muted text-muted-foreground px-2 py-0.5 text-xs font-medium">
              Not connected
            </span>
          )}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Push every AI Garage invoice and Stripe payment to your Xero organisation automatically. Your accountant sees the books up to date without manual entry.
        </p>
      </div>

      {connected ? (
        <div className="flex flex-col gap-3">
          <ul className="text-xs text-muted-foreground space-y-1">
            <li>
              Connected organisation:{" "}
              <span className="font-medium text-foreground">{tenantName ?? "—"}</span>
            </li>
            {connectedAt && (
              <li>
                Connected on:{" "}
                <span className="font-medium text-foreground">
                  {new Date(connectedAt).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </span>
              </li>
            )}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleConnect} variant="outline" disabled={pending}>
              Reconnect / switch organisation
            </Button>
            <Button onClick={handleDisconnect} variant="destructive" loading={pending}>
              Disconnect
            </Button>
          </div>
        </div>
      ) : (
        <Button onClick={handleConnect} disabled={!canManage || pending}>
          Connect Xero
        </Button>
      )}

      {!canManage && !connected && (
        <p className="text-xs text-muted-foreground">
          Only owners and admins can connect an accounting account.
        </p>
      )}
    </section>
  );
}
