"use client";

import { useState, useTransition } from "react";
import { updateBusinessHours } from "./actions";
import { Button } from "@/components/ui/button";
import {
  WEEKDAY_ORDER,
  WEEKDAY_FULL,
  HALF_HOUR_OPTIONS,
  type WeeklyHours,
} from "@/lib/business-hours";

type DayState = { open: boolean; openMin: number; closeMin: number };

const DEFAULT_OPEN = 480; // 08:00
const DEFAULT_CLOSE = 1080; // 18:00

function initialState(weekly: WeeklyHours): Record<number, DayState> {
  const out: Record<number, DayState> = {};
  for (const wd of WEEKDAY_ORDER) {
    const h = weekly[wd];
    out[wd] = h
      ? { open: true, openMin: h.open, closeMin: h.close }
      : { open: false, openMin: DEFAULT_OPEN, closeMin: DEFAULT_CLOSE };
  }
  return out;
}

export function BusinessHoursForm({
  initialWeekly,
  canEdit,
}: {
  initialWeekly: WeeklyHours;
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [days, setDays] = useState<Record<number, DayState>>(() => initialState(initialWeekly));

  function patch(wd: number, next: Partial<DayState>) {
    setDays((prev) => ({ ...prev, [wd]: { ...prev[wd], ...next } }));
  }

  // Fan one day's hours out to a set of target weekdays (Cal.com "copy to").
  function copyTo(sourceWd: number, targets: number[]) {
    setDays((prev) => {
      const src = prev[sourceWd];
      const next = { ...prev };
      for (const wd of targets) next[wd] = { ...src };
      return next;
    });
  }

  function handleSubmit(formData: FormData) {
    setError(null);
    setSaved(false);

    const weekly: WeeklyHours = {};
    for (const wd of WEEKDAY_ORDER) {
      const d = days[wd];
      if (!d.open) continue;
      if (d.openMin >= d.closeMin) {
        setError(`${WEEKDAY_FULL[wd]}: opening time must be before closing time.`);
        return;
      }
      weekly[wd] = { open: d.openMin, close: d.closeMin };
    }
    if (Object.keys(weekly).length === 0) {
      setError("Pick at least one open day.");
      return;
    }

    formData.set("weekly", JSON.stringify(weekly));
    startTransition(async () => {
      const result = await updateBusinessHours(formData);
      if ("error" in result) setError(result.error);
      else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    });
  }

  // Monday is the natural "copy from" source.
  const monday = days[1];

  return (
    <section className="rounded-lg border p-4">
      <h2 className="mb-1 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        Opening hours
      </h2>
      <p className="mb-4 text-xs text-muted-foreground">
        Set the hours for each day. Closed days gate the public booking widget and the AI receptionist —
        customers can&apos;t book when you&apos;re shut.
      </p>

      <form action={handleSubmit} className="flex flex-col gap-2">
        {WEEKDAY_ORDER.map((wd) => {
          const d = days[wd];
          return (
            <div key={wd} className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2">
              <label className="flex w-32 items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={d.open}
                  disabled={!canEdit}
                  onChange={(e) => patch(wd, { open: e.target.checked })}
                  className="h-4 w-4 rounded border-input"
                />
                {WEEKDAY_FULL[wd]}
              </label>

              {d.open ? (
                <div className="flex items-center gap-2 text-sm">
                  <TimeSelect
                    value={d.openMin}
                    disabled={!canEdit}
                    onChange={(v) => patch(wd, { openMin: v })}
                  />
                  <span className="text-muted-foreground">to</span>
                  <TimeSelect
                    value={d.closeMin}
                    disabled={!canEdit}
                    onChange={(v) => patch(wd, { closeMin: v })}
                  />
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">Closed</span>
              )}
            </div>
          );
        })}

        {canEdit && (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Copy Monday&apos;s hours to:</span>
            <button
              type="button"
              onClick={() => copyTo(1, [2, 3, 4, 5])}
              className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted/50"
            >
              Mon–Fri
            </button>
            <button
              type="button"
              onClick={() => copyTo(1, [2, 3, 4, 5, 6, 0])}
              className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted/50"
            >
              All days
            </button>
            <span className="text-[11px] text-muted-foreground">
              (Mon {minLabel(monday.openMin)}–{minLabel(monday.closeMin)})
            </span>
          </div>
        )}

        {canEdit && (
          <div className="mt-2">
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

function TimeSelect({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      className="rounded-md border bg-background px-2 py-1.5 text-sm disabled:opacity-50"
    >
      {HALF_HOUR_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function minLabel(min: number): string {
  return HALF_HOUR_OPTIONS.find((o) => o.value === min)?.label ?? "";
}
