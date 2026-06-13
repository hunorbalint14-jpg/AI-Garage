"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, Pause, Square, Clock, Pencil } from "lucide-react";
import { clockIn, clockOut, pauseClock, resumeClock, adjustEntryDuration } from "../actions";
import { formatMinutes } from "@/lib/time-tracking";

export type TimeEntryView = {
  id: string;
  userId: string;
  userName: string;
  status: string; // running | paused | completed
  minutes: number;
  canAdjust: boolean;
};

type ClockResult = { error: string } | { success: true };

type ClockPhase = "out" | "running" | "paused";

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  running: { label: "Running", className: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400" },
  paused: { label: "Paused", className: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400" },
  completed: { label: "Done", className: "bg-muted text-muted-foreground" },
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

  const myActive = entries.find((e) => e.userId === currentUserId && e.status !== "completed") ?? null;
  const actual = entries.reduce((s, e) => s + e.minutes, 0);
  const overEstimate = estimateMinutes > 0 && actual > estimateMinutes;

  // Optimistic clock phase so the button reacts the instant it's tapped,
  // rather than waiting for the server action + router.refresh() round-trip.
  // useOptimistic reverts to the real (prop-derived) phase once the refreshed
  // server data lands, so a failed action self-corrects.
  const realPhase: ClockPhase = myActive ? (myActive.status === "paused" ? "paused" : "running") : "out";
  const [phase, setPhase] = useOptimistic<ClockPhase>(realPhase);

  function run(fn: () => Promise<ClockResult>, optimistic?: ClockPhase) {
    setError(null);
    startTransition(async () => {
      if (optimistic) setPhase(optimistic);
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
            <p className="text-xs text-muted-foreground">Actual (active)</p>
            <p className={`text-lg font-bold tabular-nums ${overEstimate ? "text-amber-600 dark:text-amber-400" : ""}`}>
              {formatMinutes(actual)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Estimate</p>
            <p className="text-lg font-bold tabular-nums">{estimateMinutes > 0 ? formatMinutes(estimateMinutes) : "—"}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {phase === "out" && (
            <button
              type="button"
              onClick={() => run(() => clockIn(jobId), "running")}
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-50"
            >
              <Play className="h-4 w-4" /> Clock in
            </button>
          )}
          {/* Optimistic clock-in flips the phase before the new entry id exists;
              show a disabled placeholder until router.refresh() lands myActive. */}
          {phase !== "out" && !myActive && (
            <button
              type="button"
              disabled
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground opacity-50"
            >
              <Play className="h-4 w-4" /> Starting…
            </button>
          )}
          {phase === "running" && myActive && (
            <button
              type="button"
              onClick={() => run(() => pauseClock(myActive.id), "paused")}
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
            >
              <Pause className="h-4 w-4" /> Pause
            </button>
          )}
          {phase === "paused" && myActive && (
            <button
              type="button"
              onClick={() => run(() => resumeClock(myActive.id), "running")}
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-50"
            >
              <Play className="h-4 w-4" /> Resume
            </button>
          )}
          {phase !== "out" && myActive && (
            <button
              type="button"
              onClick={() => run(() => clockOut(myActive.id), "out")}
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
            >
              <Square className="h-4 w-4" /> Clock out
            </button>
          )}
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {entries.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1 border-t pt-3 text-sm">
          {entries.map((e) => (
            <EntryRow key={e.id} entry={e} pending={pending} onAdjust={(mins) => run(() => adjustEntryDuration(e.id, mins))} />
          ))}
        </ul>
      )}
    </section>
  );
}

function EntryRow({
  entry,
  pending,
  onAdjust,
}: {
  entry: TimeEntryView;
  pending: boolean;
  onAdjust: (minutes: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(entry.minutes));
  const badge = STATUS_BADGE[entry.status] ?? STATUS_BADGE.completed;

  return (
    <li className="flex items-center justify-between gap-3 py-1">
      <span className="flex items-center gap-2">
        {entry.userName}
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.className}`}>{badge.label}</span>
      </span>

      {editing ? (
        <span className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={1440}
            value={value}
            onChange={(ev) => setValue(ev.target.value)}
            className="w-20 rounded-md border bg-background px-2 py-1 text-right text-sm"
            aria-label="Minutes"
          />
          <span className="text-xs text-muted-foreground">min</span>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              const n = Number(value);
              if (Number.isFinite(n)) onAdjust(n);
              setEditing(false);
            }}
            className="rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            Save
          </button>
          <button type="button" onClick={() => setEditing(false)} className="text-xs text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        </span>
      ) : (
        <span className="flex items-center gap-2">
          <span className="tabular-nums text-muted-foreground">{formatMinutes(entry.minutes)}</span>
          {entry.canAdjust && (
            <button
              type="button"
              onClick={() => {
                setValue(String(entry.minutes));
                setEditing(true);
              }}
              className="text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Adjust duration"
              title="Adjust duration"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      )}
    </li>
  );
}
