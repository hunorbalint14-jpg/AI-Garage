"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { returnCourtesyCar } from "./actions";
import { uploadLoanPhotos } from "./fleet-section";

const INPUT_CLASS =
  "w-full rounded-md border border-black/20 dark:border-white/25 bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

const FUEL_LABELS = ["Empty", "1/8", "1/4", "3/8", "1/2", "5/8", "3/4", "7/8", "Full"];

export type LoanView = {
  id: string;
  carId: string;
  jobId: string | null;
  carLabel: string;
  customerName: string;
  customerPhone: string | null;
  loanedAt: string;
  dueBackAt: string | null;
  returnedAt: string | null;
  fuelOut: number | null;
  fuelIn: number | null;
  odometerOut: number | null;
  odometerIn: number | null;
  conditionOut: string | null;
  conditionIn: string | null;
  licenceShareCode: string | null;
  agreementName: string | null;
  photoUrlsOut: string[];
  photoUrlsIn: string[];
};

function PhotoStrip({ urls, label }: { urls: string[]; label: string }) {
  if (urls.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      {urls.map((url, i) => (
        <a key={i} href={url} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={`${label} photo ${i + 1}`} className="h-14 w-14 rounded-md border object-cover" />
        </a>
      ))}
    </div>
  );
}

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function fuelLabel(v: number | null): string {
  return v == null ? "—" : FUEL_LABELS[v] ?? String(v);
}

export function LoansSection({ loans }: { loans: LoanView[] }) {
  const [returningId, setReturningId] = useState<string | null>(null);
  const [returnPhotos, setReturnPhotos] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const open = loans.filter((l) => !l.returnedAt);
  const history = loans.filter((l) => l.returnedAt);

  function handleReturn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    const loanId = String(formData.get("loanId") ?? "");
    startTransition(async () => {
      // Photos first — the loan row still exists either way, and uploading
      // before the return means the evidence is attached before sign-off.
      if (returnPhotos.length > 0) {
        const photoError = await uploadLoanPhotos(loanId, "in", returnPhotos);
        if (photoError) {
          setError(photoError);
          return;
        }
      }
      const result = await returnCourtesyCar(formData);
      if ("error" in result) setError(result.error);
      else {
        setReturningId(null);
        setReturnPhotos([]);
      }
    });
  }

  return (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Out now
        </h2>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {open.length === 0 ? (
          <p className="text-sm text-muted-foreground">No cars out on loan.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {open.map((loan) => {
              const overdue = loan.dueBackAt && new Date(loan.dueBackAt) < new Date();
              const isReturning = returningId === loan.id;
              return (
                <div key={loan.id} className="rounded-lg border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">
                        {loan.carLabel}
                        <span className="ml-2 font-normal text-muted-foreground">
                          → {loan.customerName}
                          {loan.customerPhone ? ` (${loan.customerPhone})` : ""}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Out {fmt(loan.loanedAt)} · due back {fmt(loan.dueBackAt)}
                        {overdue && <span className="ml-1 font-medium text-red-600">overdue</span>}
                        {" · "}fuel {fuelLabel(loan.fuelOut)}
                        {loan.odometerOut != null && ` · ${loan.odometerOut.toLocaleString()} mi`}
                        {loan.licenceShareCode && ` · share code ${loan.licenceShareCode}`}
                      </p>
                      {loan.conditionOut && (
                        <p className="mt-1 text-xs text-muted-foreground">Condition out: {loan.conditionOut}</p>
                      )}
                      {loan.jobId && (
                        <p className="mt-1 text-xs">
                          <Link href={`/staff/jobs/${loan.jobId}`} className="underline">
                            Linked job →
                          </Link>
                        </p>
                      )}
                      <PhotoStrip urls={loan.photoUrlsOut} label="Out" />
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setReturningId(isReturning ? null : loan.id)}>
                      {isReturning ? "Close" : "Return car"}
                    </Button>
                  </div>

                  {isReturning && (
                    <form onSubmit={handleReturn} className="mt-3 grid gap-3 border-t pt-3 sm:grid-cols-4">
                      <input type="hidden" name="loanId" value={loan.id} />
                      <label className="text-xs text-muted-foreground">
                        Fuel in *
                        <select name="fuelIn" className={`${INPUT_CLASS} mt-1`} defaultValue={String(loan.fuelOut ?? 8)} disabled={pending}>
                          {FUEL_LABELS.map((label, i) => (
                            <option key={i} value={i}>{label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs text-muted-foreground">
                        Odometer in
                        <input type="number" name="odometerIn" min={0} className={`${INPUT_CLASS} mt-1`} disabled={pending} />
                      </label>
                      <label className="text-xs text-muted-foreground sm:col-span-2">
                        Condition / new damage
                        <input name="conditionIn" className={`${INPUT_CLASS} mt-1`} disabled={pending} />
                      </label>
                      <label className="text-xs text-muted-foreground sm:col-span-3">
                        Return photos (up to 6)
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          multiple
                          className="mt-1 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-xs"
                          onChange={(e) => setReturnPhotos(Array.from(e.target.files ?? []).slice(0, 6))}
                          disabled={pending}
                        />
                      </label>
                      <div className="sm:col-span-4">
                        <Button type="submit" size="sm" disabled={pending}>
                          {pending ? "Saving…" : "Complete return"}
                        </Button>
                      </div>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          History
        </h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No completed loans yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Car</th>
                  <th className="px-3 py-2 font-medium">Customer</th>
                  <th className="px-3 py-2 font-medium">Out</th>
                  <th className="px-3 py-2 font-medium">Back</th>
                  <th className="px-3 py-2 font-medium">Fuel out/in</th>
                  <th className="px-3 py-2 font-medium">Damage noted</th>
                </tr>
              </thead>
              <tbody>
                {history.map((loan) => (
                  <tr key={loan.id} className="border-t align-top">
                    <td className="px-3 py-2 font-mono text-xs">{loan.carLabel}</td>
                    <td className="px-3 py-2">{loan.customerName}</td>
                    <td className="px-3 py-2 text-xs tabular-nums">{fmt(loan.loanedAt)}</td>
                    <td className="px-3 py-2 text-xs tabular-nums">{fmt(loan.returnedAt)}</td>
                    <td className="px-3 py-2 text-xs">
                      {fuelLabel(loan.fuelOut)} → {fuelLabel(loan.fuelIn)}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {loan.conditionIn || "—"}
                      <PhotoStrip urls={[...loan.photoUrlsOut, ...loan.photoUrlsIn]} label="" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
