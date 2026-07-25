import Link from "next/link";
import { Radio } from "lucide-react";
import { PRELIVE_EXPLAINER } from "@/lib/prelive";

// Persistent strip while the active branch is prelive (#585). Everyone sees it
// — a technician needs to know a booking they take today won't be confirmed to
// the customer — and it isn't dismissible: going live is the dismiss.
//
// Deliberately reassuring rather than alarming: prelive is the safe state, and
// the owner chose it. The banner exists so nobody wonders why it's quiet.
export function PreliveBanner({ locationName }: { locationName: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-start gap-3 rounded-lg border border-ws-blue-border bg-ws-blue-bg px-4 py-3">
      <Radio className="mt-0.5 h-4 w-4 shrink-0 text-ws-blue" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ws-blue">{locationName} is prelive</p>
        <p className="mt-0.5 text-sm text-ws-text-2">{PRELIVE_EXPLAINER}</p>
      </div>
      <Link
        href="/staff/automations"
        className="shrink-0 text-sm font-medium text-ws-blue underline underline-offset-2"
      >
        What&apos;s paused
      </Link>
    </div>
  );
}
