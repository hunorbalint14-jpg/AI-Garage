"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startBooking, cancelBooking, markNoShow, deleteBooking } from "../actions";
import { Button } from "@/components/ui/button";

type Props = {
  bookingId: string;
  status: string;
  hasJob: boolean;
  jobId?: string;
};

export function BookingActions({ bookingId, status, hasJob, jobId }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isFinal = status === "complete" || status === "cancelled" || status === "no_show";

  function handleStart() {
    setError(null);
    startTransition(async () => {
      const result = await startBooking(bookingId);
      if ("error" in result) {
        setError(result.error);
      } else if (result.jobId) {
        router.push(`/staff/jobs/${result.jobId}`);
      }
    });
  }

  function handleCancel() {
    if (!confirm("Cancel this booking?")) return;
    setError(null);
    startTransition(async () => {
      const result = await cancelBooking(bookingId);
      if ("error" in result) setError(result.error);
    });
  }

  function handleNoShow() {
    if (!confirm("Mark this booking as no-show?")) return;
    setError(null);
    startTransition(async () => {
      const result = await markNoShow(bookingId);
      if ("error" in result) setError(result.error);
    });
  }

  function handleDelete() {
    if (!confirm("Delete this booking permanently?")) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteBooking(bookingId);
      if ("error" in result) setError(result.error);
    });
  }

  return (
    <div className="rounded-lg border p-4 flex flex-col gap-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Actions</h2>
      <div className="flex flex-wrap gap-2">
        {!hasJob && !isFinal && (
          <Button onClick={handleStart} disabled={pending}>
            {pending ? "Starting…" : "Start work (create job card)"}
          </Button>
        )}
        {hasJob && jobId && (
          <Button variant="outline" onClick={() => router.push(`/staff/jobs/${jobId}`)}>
            Open job card
          </Button>
        )}
        {!isFinal && (
          <>
            <Button variant="outline" onClick={handleCancel} disabled={pending}>
              Cancel booking
            </Button>
            {status === "scheduled" && (
              <Button variant="outline" onClick={handleNoShow} disabled={pending}>
                Mark no-show
              </Button>
            )}
          </>
        )}
        <Button variant="destructive" onClick={handleDelete} disabled={pending}>
          Delete
        </Button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
