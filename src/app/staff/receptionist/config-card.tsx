"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { saveReceptionistConfig } from "./actions";

export function ConfigCard({
  enabled: initialEnabled,
  twilioNumber,
  forwardToPhone: initialForward,
  forwardTimeoutSeconds: initialTimeout,
  canManage,
}: {
  enabled: boolean;
  twilioNumber: string | null;
  forwardToPhone: string;
  forwardTimeoutSeconds: number;
  canManage: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [forwardToPhone, setForwardToPhone] = useState(initialForward);
  const [timeout, setTimeoutSecs] = useState(initialTimeout);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSave() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await saveReceptionistConfig({
        enabled,
        forwardToPhone,
        forwardTimeoutSeconds: timeout,
      });
      if ("error" in result) setError(result.error);
      else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Setup
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Incoming calls ring your phone first; if nobody answers, the receptionist texts the
            caller back and takes it from there. Give customers the number below, or forward your
            existing line to it.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 text-sm">
        <div>
          <span className="text-xs text-muted-foreground">Receptionist number</span>
          <p className="mt-1 font-mono">
            {twilioNumber ?? <span className="text-muted-foreground">Not provisioned yet — contact support</span>}
          </p>
        </div>
        <label className="text-xs text-muted-foreground">
          Forward calls to (your phone)
          <input
            className="mt-1 w-full rounded border bg-background px-2 py-1 text-sm disabled:opacity-50"
            value={forwardToPhone}
            onChange={(e) => setForwardToPhone(e.target.value)}
            placeholder="+44..."
            disabled={!canManage || pending}
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Ring for (seconds) before the AI answers
          <input
            type="number"
            min={5}
            max={60}
            className="mt-1 w-24 rounded border bg-background px-2 py-1 text-sm disabled:opacity-50"
            value={timeout}
            onChange={(e) => setTimeoutSecs(Number(e.target.value))}
            disabled={!canManage || pending}
          />
        </label>
      </div>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={!canManage || pending || !twilioNumber}
          />
          Receptionist enabled
        </label>
        {canManage && (
          <Button size="sm" onClick={handleSave} disabled={pending}>
            {pending ? "Saving…" : saved ? "Saved" : "Save"}
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}
