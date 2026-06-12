"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startBooking, cancelBooking, markNoShow, deleteBooking, chargeNoShowFee } from "../actions";
import { Button } from "@/components/ui/button";

type Props = {
  bookingId: string;
  status: string;
  hasJob: boolean;
  jobId?: string;
  cardOnFile?: boolean;
  noShowFeePence?: number;
  noShowChargedAt?: string | null;
  noShowChargeAmountPence?: number | null;
  noShowChargeError?: string | null;
};

const fmtGBP = (pence: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);

export function BookingActions({
  bookingId,
  status,
  hasJob,
  jobId,
  cardOnFile = false,
  noShowFeePence = 0,
  noShowChargedAt = null,
  noShowChargeAmountPence = null,
  noShowChargeError = null,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [chargeInfo, setChargeInfo] = useState<string | null>(null);

  const isFinal = status === "complete" || status === "cancelled" || status === "no_show";
  const canChargeNoShow =
    status === "no_show" && cardOnFile && noShowFeePence > 0 && !noShowChargedAt;

  function handleChargeNoShow() {
    if (!confirm(`Charge the ${fmtGBP(noShowFeePence)} no-show fee to the customer's saved card?`))
      return;
    setError(null);
    setChargeInfo(null);
    startTransition(async () => {
      const result = await chargeNoShowFee(bookingId);
      if ("error" in result) setError(result.error);
      else setChargeInfo(`No-show fee of ${fmtGBP(result.amountPence)} charged.`);
    });
  }

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
          <Button onClick={handleStart} loading={pending}>
            Start work (create job card)
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
        {canChargeNoShow && (
          <Button variant="outline" onClick={handleChargeNoShow} disabled={pending}>
            Charge {fmtGBP(noShowFeePence)} no-show fee
          </Button>
        )}
        <Button variant="destructive" onClick={handleDelete} disabled={pending}>
          Delete
        </Button>
      </div>
      {noShowChargedAt && noShowChargeAmountPence != null && (
        <p className="text-sm text-green-700">
          No-show fee of {fmtGBP(noShowChargeAmountPence)} charged on{" "}
          {new Date(noShowChargedAt).toLocaleDateString("en-GB")}.
        </p>
      )}
      {noShowChargeError && !noShowChargedAt && (
        <p className="text-sm text-amber-700">Last charge attempt failed: {noShowChargeError}</p>
      )}
      {status === "no_show" && !cardOnFile && noShowFeePence > 0 && (
        <p className="text-xs text-muted-foreground">
          No card on file for this booking — the no-show fee can&apos;t be charged.
        </p>
      )}
      {chargeInfo && <p className="text-sm text-green-700">{chargeInfo}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
