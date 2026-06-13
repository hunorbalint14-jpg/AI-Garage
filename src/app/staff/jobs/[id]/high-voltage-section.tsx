"use client";

import { useState, useTransition } from "react";
import { setJobHighVoltage } from "../actions";
import type { HvWarning } from "@/lib/ev-readiness";

export function HighVoltageSection({
  jobId,
  initialHighVoltage,
  warning,
}: {
  jobId: string;
  initialHighVoltage: boolean;
  warning: HvWarning;
}) {
  const [highVoltage, setHighVoltage] = useState(initialHighVoltage);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleToggle() {
    const next = !highVoltage;
    setHighVoltage(next);
    setError(null);
    startTransition(async () => {
      const result = await setJobHighVoltage(jobId, next);
      if ("error" in result) {
        setHighVoltage(!next);
        setError(result.error);
      }
    });
  }

  return (
    <section className="rounded-lg border p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            High-voltage vehicle
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Flag EVs and hybrids so only HV-qualified technicians (IMI TechSafe level 2+) pick up
            the work.
          </p>
        </div>
        <button
          onClick={handleToggle}
          disabled={pending}
          aria-label={highVoltage ? "Unflag high voltage" : "Flag high voltage"}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:cursor-not-allowed ${highVoltage ? "bg-amber-500" : "bg-muted"}`}
        >
          <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${highVoltage ? "translate-x-4" : "translate-x-0"}`} />
        </button>
      </div>

      {highVoltage && warning.kind === "no_qualified_techs" && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          ⚠ No technician at this location holds an in-date HV qualification. Record
          qualifications under EV readiness before this work starts.
        </p>
      )}
      {highVoltage && warning.kind === "assignee_unqualified" && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          ⚠ {warning.assigneeName} has no recorded HV qualification (level 2+ needed). Reassign or
          update their record under EV readiness.
        </p>
      )}
      {highVoltage && warning.kind === "assignee_expired" && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          ⚠ {warning.assigneeName}&apos;s HV qualification has expired. Reassign or renew it under
          EV readiness.
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}
