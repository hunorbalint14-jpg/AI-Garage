"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { saveFinanceConfig, type FinanceConfigView } from "./finance-actions";

const INPUT_CLASS =
  "rounded border bg-background px-2 py-1 text-sm disabled:opacity-50";

// Customer finance ("Spread the cost" on quotes). Bumper-only for now;
// Payment Assist appears once its adapter lands. Credentials are write-only:
// staff can replace them but never read them back.

export function FinanceSection({
  initial,
  canManage,
}: {
  initial: FinanceConfigView | null;
  canManage: boolean;
}) {
  const [enabled, setEnabled] = useState(initial?.enabled ?? false);
  const [demoMode, setDemoMode] = useState(initial?.demoMode ?? true);
  const [minAmount, setMinAmount] = useState(initial?.minAmount ?? 100);
  const [apiKey, setApiKey] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const hasCredentials = initial?.hasCredentials ?? false;

  function handleSave() {
    setError(null);
    setSaved(false);
    if (enabled && !hasCredentials && (!apiKey.trim() || !secret)) {
      setError("Enter the Bumper API key and secret before enabling.");
      return;
    }
    startTransition(async () => {
      const result = await saveFinanceConfig({
        provider: "bumper",
        enabled,
        demoMode,
        minAmount: Number(minAmount),
        apiKey: apiKey || undefined,
        secret: secret || undefined,
      });
      if ("error" in result) setError(result.error);
      else {
        setSaved(true);
        setApiKey("");
        setSecret("");
        setTimeout(() => setSaved(false), 2000);
      }
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <div>
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Customer finance — Bumper
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Adds a &quot;Spread the cost&quot; option to customer quotes above the minimum amount.
          Customers complete the application on Bumper&apos;s hosted checkout — card and credit
          data never touch this app. Requires a Bumper partner account
          (integrations@bumper.co).
        </p>
      </div>

      <div className="flex items-center gap-6 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={!canManage || pending}
          />
          Enabled
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={demoMode}
            onChange={(e) => setDemoMode(e.target.checked)}
            disabled={!canManage || pending}
          />
          Demo environment
        </label>
        <label className="flex items-center gap-2">
          Minimum quote total £
          <input
            type="number"
            min={0}
            step={10}
            className={`${INPUT_CLASS} w-24`}
            value={minAmount}
            onChange={(e) => setMinAmount(Number(e.target.value))}
            disabled={!canManage || pending}
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-muted-foreground">
          API key {hasCredentials && <span className="text-green-600">(set — leave blank to keep)</span>}
          <input
            type="password"
            className={`${INPUT_CLASS} mt-1 w-full`}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={hasCredentials ? "••••••••" : "From your Bumper onboarding pack"}
            disabled={!canManage || pending}
            autoComplete="off"
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Secret {hasCredentials && <span className="text-green-600">(set — leave blank to keep)</span>}
          <input
            type="password"
            className={`${INPUT_CLASS} mt-1 w-full`}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={hasCredentials ? "••••••••" : "Paste exactly as issued"}
            disabled={!canManage || pending}
            autoComplete="off"
          />
        </label>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Paste the secret exactly as issued — including any leading/trailing characters. It&apos;s
        encrypted before storage and can&apos;t be viewed again, only replaced.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {canManage && (
        <div>
          <Button size="sm" onClick={handleSave} disabled={pending}>
            {pending ? "Saving…" : saved ? "Saved" : "Save finance settings"}
          </Button>
        </div>
      )}
    </section>
  );
}
