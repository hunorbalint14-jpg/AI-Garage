"use client";

import { useState, useTransition } from "react";
import { updateBusinessHours } from "./actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: `${String(i).padStart(2, "0")}:00`,
}));

export function BusinessHoursForm({
  initialStart,
  initialEnd,
  canEdit,
}: {
  initialStart: number;
  initialEnd: number;
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleSubmit(formData: FormData) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateBusinessHours(formData);
      if ("error" in result) {
        setError(result.error);
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    });
  }

  return (
    <section className="rounded-lg border p-4">
      <h2 className="mb-1 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        Business hours
      </h2>
      <p className="mb-4 text-xs text-muted-foreground">
        Drives the day schedule grid (shown ±1 hour outside these times).
      </p>
      <form action={handleSubmit} className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="hoursStart">Opens</Label>
          <select
            id="hoursStart"
            name="hoursStart"
            defaultValue={initialStart}
            disabled={!canEdit}
            className="rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
          >
            {HOUR_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="hoursEnd">Closes</Label>
          <select
            id="hoursEnd"
            name="hoursEnd"
            defaultValue={initialEnd}
            disabled={!canEdit}
            className="rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
          >
            {HOUR_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        {canEdit && (
          <Button type="submit" disabled={pending} className="self-end">
            {pending ? "Saving…" : "Save"}
          </Button>
        )}
        {error && <p className="w-full text-sm text-red-600">{error}</p>}
        {saved && <p className="w-full text-sm text-green-700">Saved.</p>}
      </form>
    </section>
  );
}
