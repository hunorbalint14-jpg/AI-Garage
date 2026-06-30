"use client";

import { useState, useTransition } from "react";
import { updateBusinessHours } from "./actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { WEEKDAY_ORDER, WEEKDAY_SHORT } from "@/lib/business-days";

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: `${String(i).padStart(2, "0")}:00`,
}));

export function BusinessHoursForm({
  initialStart,
  initialEnd,
  initialDays,
  canEdit,
}: {
  initialStart: number;
  initialEnd: number;
  /** Open weekdays as JS getDay() numbers (0=Sun..6=Sat). */
  initialDays: number[];
  canEdit: boolean;
}) {
  const [openDays, setOpenDays] = useState<Set<number>>(() => new Set(initialDays));

  function toggleDay(day: number) {
    setOpenDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleSubmit(formData: FormData) {
    setError(null);
    setSaved(false);
    if (openDays.size === 0) {
      setError("Pick at least one open day.");
      return;
    }
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
        Opening hours &amp; days
      </h2>
      <p className="mb-4 text-xs text-muted-foreground">
        Drives the day schedule grid (shown ±1 hour outside these times). Open days gate the public
        booking widget and the AI receptionist — customers can&apos;t book on a closed day.
      </p>
      <form action={handleSubmit} className="flex flex-col gap-4">
        {/* Selected open days are submitted as repeated `days` fields. */}
        {[...openDays].map((d) => (
          <input key={d} type="hidden" name="days" value={d} />
        ))}

        <div className="flex flex-wrap items-end gap-4">
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
        </div>

        <div className="flex flex-col gap-2">
          <Label>Open days</Label>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_ORDER.map((d) => {
              const on = openDays.has(d);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => canEdit && toggleDay(d)}
                  disabled={!canEdit}
                  aria-pressed={on}
                  className={`min-w-[3rem] rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
                    on
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  {WEEKDAY_SHORT[d]}
                </button>
              );
            })}
          </div>
        </div>

        {canEdit && (
          <div>
            <Button type="submit" loading={pending}>
              Save
            </Button>
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {saved && <p className="text-sm text-green-700">Saved.</p>}
      </form>
    </section>
  );
}
