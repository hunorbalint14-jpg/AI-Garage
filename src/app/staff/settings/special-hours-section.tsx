"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { addSpecialHours, removeSpecialHours } from "./actions";
import { Button } from "@/components/ui/button";
import { HALF_HOUR_OPTIONS, minutesToLabel } from "@/lib/business-hours";

export type SpecialHoursRow = {
  id: string;
  date: string; // YYYY-MM-DD
  is_closed: boolean;
  open_minute: number | null;
  close_minute: number | null;
  note: string | null;
};

const DEFAULT_OPEN = 480;
const DEFAULT_CLOSE = 1080;

function longDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function SpecialHoursSection({
  initial,
  canEdit,
}: {
  initial: SpecialHoursRow[];
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Add-form state.
  const [date, setDate] = useState("");
  const [closed, setClosed] = useState(true);
  const [openMin, setOpenMin] = useState(DEFAULT_OPEN);
  const [closeMin, setCloseMin] = useState(DEFAULT_CLOSE);
  const [note, setNote] = useState("");

  const todayKey = new Date().toLocaleDateString("en-CA");

  function handleAdd(formData: FormData) {
    setError(null);
    if (!date) {
      setError("Pick a date.");
      return;
    }
    if (!closed && openMin >= closeMin) {
      setError("Opening time must be before closing time.");
      return;
    }
    formData.set("date", date);
    formData.set("isClosed", closed ? "1" : "");
    formData.set("openMinute", String(openMin));
    formData.set("closeMinute", String(closeMin));
    formData.set("note", note);
    startTransition(async () => {
      const result = await addSpecialHours(formData);
      if ("error" in result) setError(result.error);
      else {
        setDate("");
        setClosed(true);
        setNote("");
      }
    });
  }

  function handleRemove(id: string) {
    setError(null);
    const fd = new FormData();
    fd.set("id", id);
    startTransition(async () => {
      const result = await removeSpecialHours(fd);
      if ("error" in result) setError(result.error);
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <div>
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Special &amp; holiday hours
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Override a specific date — closed for a bank holiday, or different hours for one day. These win
          over the regular weekly hours.
        </p>
      </div>

      {initial.length > 0 ? (
        <ul className="flex flex-col divide-y rounded-md border">
          {initial.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div>
                <span className="font-medium">{longDate(r.date)}</span>
                <span className="ml-2 text-muted-foreground">
                  {r.is_closed
                    ? "Closed"
                    : r.open_minute != null && r.close_minute != null
                      ? `${minutesToLabel(r.open_minute)}–${minutesToLabel(r.close_minute)}`
                      : "Closed"}
                  {r.note ? ` · ${r.note}` : ""}
                </span>
              </div>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => handleRemove(r.id)}
                  disabled={pending}
                  aria-label="Remove"
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No special hours set.</p>
      )}

      {canEdit && (
        <form action={handleAdd} className="flex flex-col gap-3 rounded-md border border-dashed p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Date</label>
              <input
                type="date"
                value={date}
                min={todayKey}
                onChange={(e) => setDate(e.target.value)}
                className="rounded-md border bg-background px-2 py-1.5 text-sm"
              />
            </div>
            <label className="flex items-center gap-2 py-2 text-sm">
              <input
                type="checkbox"
                checked={closed}
                onChange={(e) => setClosed(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              Closed all day
            </label>
            {!closed && (
              <div className="flex items-center gap-2 text-sm">
                <TimeSelect value={openMin} onChange={setOpenMin} />
                <span className="text-muted-foreground">to</span>
                <TimeSelect value={closeMin} onChange={setCloseMin} />
              </div>
            )}
          </div>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional) — e.g. Christmas Day"
            maxLength={120}
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
          />
          <div>
            <Button type="submit" loading={pending} variant="outline">
              Add special hours
            </Button>
          </div>
        </form>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}

function TimeSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="rounded-md border bg-background px-2 py-1.5 text-sm"
    >
      {HALF_HOUR_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
