"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-provider";
import { disconnectAccounting, retryAccountingSync } from "./accounting-actions";

export type AccountingHealthView = {
  unsyncedInvoices: number;
  unsyncedPayments: number;
  unsyncedCreditNotes: number;
  failures30d: number;
  recentFailures: { id: string; entityType: string; error: string | null; createdAt: string }[];
  paidTotal30d: number;
  syncedPaidTotal30d: number;
};

export type AccountingConnectionView = {
  provider: "xero" | "quickbooks";
  label: string; // "Xero" | "QuickBooks"
  displayName: string | null;
  connectedAt: string;
};

type Props = {
  connection: AccountingConnectionView | null;
  health: AccountingHealthView | null;
  canManage: boolean;
};

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

const ENTITY_LABELS: Record<string, string> = {
  invoice: "Invoice",
  payment: "Payment",
  credit_note: "Credit note",
  payout: "Payout",
  contact: "Contact",
};

export function AccountingSection({ connection, health, canManage }: Props) {
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [retryNote, setRetryNote] = useState<string | null>(null);

  function handleConnect(provider: "xero" | "quickbooks") {
    window.location.href = `/api/${provider}/connect/begin`;
  }

  async function handleDisconnect() {
    if (!connection) return;
    const ok = await confirm({
      title: connection.displayName
        ? `Disconnect ${connection.label} (${connection.displayName})?`
        : `Disconnect ${connection.label}?`,
      description:
        "New invoices and payments stop syncing until you reconnect. Already-synced records stay in your accounting system.",
      confirmLabel: "Disconnect",
      destructive: true,
    });
    if (!ok) return;
    startTransition(async () => {
      await disconnectAccounting();
      window.location.reload();
    });
  }

  function handleRetry() {
    setRetryNote(null);
    startTransition(async () => {
      const res = await retryAccountingSync();
      if ("error" in res) {
        setRetryNote(res.error);
      } else if (res.attempted === 0) {
        setRetryNote("Nothing to retry — everything in the window is synced.");
      } else {
        setRetryNote(`Retried ${res.attempted}; ${res.synced} synced. Failures appear below.`);
        window.location.reload();
      }
    });
  }

  const unsyncedTotal = health
    ? health.unsyncedInvoices + health.unsyncedPayments + health.unsyncedCreditNotes
    : 0;
  const driftPounds = health ? health.paidTotal30d - health.syncedPaidTotal30d : 0;
  const healthy = health ? unsyncedTotal === 0 && health.failures30d === 0 : false;

  return (
    <section className="rounded-lg border p-5 flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          Accounting
          {connection ? (
            <span className="rounded-full bg-ws-green-bg text-ws-green px-2 py-0.5 text-xs font-medium">
              {connection.label} connected
            </span>
          ) : (
            <span className="rounded-full bg-muted text-muted-foreground px-2 py-0.5 text-xs font-medium">
              Not connected
            </span>
          )}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Push every AI Garage invoice, payment and refund to your accounting system automatically.
          Your accountant sees the books up to date without manual entry.
        </p>
      </div>

      {connection ? (
        <div className="flex flex-col gap-3">
          <ul className="text-xs text-muted-foreground space-y-1">
            <li>
              Connected organisation:{" "}
              <span className="font-medium text-foreground">{connection.displayName ?? "—"}</span>
            </li>
            <li>
              Connected on:{" "}
              <span className="font-medium text-foreground">
                {new Date(connection.connectedAt).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </span>
            </li>
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => handleConnect(connection.provider)} variant="outline" disabled={!canManage || pending}>
              Reconnect / switch organisation
            </Button>
            <Button onClick={handleDisconnect} variant="destructive" loading={pending} disabled={!canManage}>
              Disconnect
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => handleConnect("xero")} disabled={!canManage || pending}>
              Connect Xero
            </Button>
            <Button onClick={() => handleConnect("quickbooks")} disabled={!canManage || pending}>
              Connect QuickBooks
            </Button>
            <Button variant="outline" disabled title="Coming soon">
              Sage — coming soon
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">One accounting connection per organisation.</p>
        </div>
      )}

      {!canManage && !connection && (
        <p className="text-xs text-muted-foreground">
          Only owners and admins can connect an accounting account.
        </p>
      )}

      {/* ── Books health ─────────────────────────────────────────── */}
      {connection && health && (
        <div className="rounded-md border p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              Books health
              {healthy ? (
                <span className="rounded-full bg-ws-green-bg text-ws-green px-2 py-0.5 text-xs font-medium">
                  In sync
                </span>
              ) : (
                <span className="rounded-full bg-ws-amber-bg text-ws-amber px-2 py-0.5 text-xs font-medium">
                  Needs attention
                </span>
              )}
            </h3>
            {canManage && !healthy && (
              <Button size="sm" variant="outline" onClick={handleRetry} loading={pending}>
                Retry sync now
              </Button>
            )}
          </div>

          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Unsynced invoices</dt>
              <dd className={`font-medium ${health.unsyncedInvoices > 0 ? "text-ws-amber" : ""}`}>
                {health.unsyncedInvoices}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Unsynced payments</dt>
              <dd className={`font-medium ${health.unsyncedPayments > 0 ? "text-ws-amber" : ""}`}>
                {health.unsyncedPayments}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Unsynced refunds</dt>
              <dd className={`font-medium ${health.unsyncedCreditNotes > 0 ? "text-ws-amber" : ""}`}>
                {health.unsyncedCreditNotes}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Failures (30 days)</dt>
              <dd className={`font-medium ${health.failures30d > 0 ? "text-ws-amber" : ""}`}>
                {health.failures30d}
              </dd>
            </div>
          </dl>

          <p className="text-xs text-muted-foreground">
            Payments taken in the last 30 days: {gbp.format(health.paidTotal30d)} — of which{" "}
            {gbp.format(health.syncedPaidTotal30d)} has reached {connection.label}
            {driftPounds > 0.005 && (
              <span className="text-ws-amber font-medium"> ({gbp.format(driftPounds)} not yet in your books)</span>
            )}
            .
          </p>

          {retryNote && <p className="text-xs text-muted-foreground">{retryNote}</p>}

          {health.recentFailures.length > 0 && (
            <div className="flex flex-col gap-1">
              <h4 className="text-xs font-medium">Recent failures</h4>
              <ul className="text-xs text-muted-foreground space-y-1">
                {health.recentFailures.map((f) => (
                  <li key={f.id} className="flex flex-col">
                    <span>
                      <span className="font-medium text-foreground">
                        {ENTITY_LABELS[f.entityType] ?? f.entityType}
                      </span>{" "}
                      —{" "}
                      {new Date(f.createdAt).toLocaleString("en-GB", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {f.error && <span className="break-words">{f.error}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
