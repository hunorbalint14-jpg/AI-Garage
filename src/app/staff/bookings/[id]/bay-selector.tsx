"use client";

import { useState, useTransition } from "react";
import { assignBay } from "../actions";

type Bay = { id: string; name: string };

export function BaySelector({
  bookingId,
  bays,
  currentBayId,
}: {
  bookingId: string;
  bays: Bay[];
  currentBayId: string | null;
}) {
  const [selected, setSelected] = useState(currentBayId ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleChange(value: string) {
    setSelected(value);
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await assignBay(bookingId, value || null);
      if ("error" in result) {
        setError(result.error);
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    });
  }

  if (bays.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No bays configured. <a href="/staff/bays" className="underline">Set up bays →</a>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <select
        value={selected}
        onChange={(e) => handleChange(e.target.value)}
        disabled={pending}
        className="rounded-md border bg-background px-3 py-1.5 text-sm disabled:opacity-50"
      >
        <option value="">Unassigned</option>
        {bays.map((b) => (
          <option key={b.id} value={b.id}>{b.name}</option>
        ))}
      </select>
      {pending && <span className="text-xs text-muted-foreground">Saving…</span>}
      {saved && <span className="text-xs text-green-600">Saved</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
