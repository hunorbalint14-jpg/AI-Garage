"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, Square, Clock } from "lucide-react";
import { clockIn, clockOut } from "../actions";
import { formatMinutes } from "@/lib/time-tracking";

export type TimeEntryView = {
  id: string;
  userId: string;
  userName: string;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number | null;
};

export function JobTimeTracking({
  jobId,
  entries,
  estimateMinutes,
  currentUserId,
}: {
  jobId: string;
  entries: TimeEntryView[];
  estimateMinutes: number;
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const myOpen = entries.find((e) => e.userId === currentUserId && !e.endedAt) ?? null;
  const actual = entries.filter((e) => e.endedAt).reduce((s, e) => s + (e.durationMinutes ?? 0), 0);

  const byPerson = new Map<string, { name: string; minutes: number; running: boolean }>();
  for (const e of entries) {
    const cur = byPerson.get(e.userId) ?? { name: e.userName, minutes: 0, running: false };
    cur.minutes += e.durationMinutes ?? 0;
    if (!e.endedAt) cur.running = true;
    byPerson.set(e.userId, cur);
  }
  const people = [...byPerson.values()].sort((a, b) => b.minutes - a.minutes);

  const overEstimate = estimateMinutes > 0 && actual > estimateMinutes;

  function run(fn: () => Promise<{ error: string } | { success: true }>) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if ("error" in r) setError(r.error);
      else router.refresh();
    });
  }

  return (
    <section className="rounded-lg border p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        <Clock className="h-4 w-4" /> Time tracking
      </h2>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-baseline gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Actual</p>
            <p className={`text-lg font-bold tabular-nums ${overEstimate ? "text-amber-600 dark:text-amber-400" : ""}`}>
              {formatMinutes(actual)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Estimate</p>
            <p className="text-lg font-bold tabular-nums">{estimateMinutes > 0 ? formatMinutes(estimateMinutes) : "—"}</p>
          </div>
        </div>

        {myOpen ? (
          <button
            type="button"
            onClick={() => run(() => clockOut(myOpen.id))}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          >
            <Square className="h-4 w-4" /> {pending ? "Working…" : "Clock out"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => run(() => clockIn(jobId))}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-50"
          >
            <Play className="h-4 w-4" /> {pending ? "Working…" : "Clock in"}
          </button>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {people.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1.5 border-t pt-3 text-sm">
          {people.map((p) => (
            <li key={p.name} className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                {p.name}
                {p.running && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-950/40 dark:text-green-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500" /> Running
                  </span>
                )}
              </span>
              <span className="tabular-nums text-muted-foreground">{formatMinutes(p.minutes)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
