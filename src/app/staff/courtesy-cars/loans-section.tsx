"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { returnCourtesyCar } from "./actions";
import { uploadLoanPhotos } from "./fleet-section";
import {
  EvidenceChip,
  FuelChipPicker,
  INPUT_CLASS,
  PlateChip,
  SECTION_LABEL_CLASS,
  StatusChip,
  agoLabel,
  fmtDateTime,
  fuelLabel,
  lighten,
  useClientNow,
} from "./courtesy-ui";

export type LoanView = {
  id: string;
  carId: string;
  jobId: string | null;
  jobLabel: string | null;
  carReg: string;
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
  signatureUrl: string | null;
};

const DAY_MS = 864e5;

type DiaryEvent = {
  at: number;
  tone: "amber" | "green";
  text: string;
  photos: string[];
  signatureUrl: string | null;
};

type DiaryDay = { key: string; label: string; today: boolean; events: DiaryEvent[] };

/** Check-out + return events off the loans the page already fetched, newest first. */
function buildDiary(loans: LoanView[], now: number): DiaryDay[] {
  const events: DiaryEvent[] = [];
  for (const loan of loans) {
    events.push({
      at: Date.parse(loan.loanedAt),
      tone: "amber",
      text: `${loan.carReg} → ${loan.customerName}${
        loan.dueBackAt ? `, due ${fmtDateTime(loan.dueBackAt)}` : ""
      }`,
      photos: [],
      signatureUrl: null,
    });
    if (!loan.returnedAt) continue;
    // A closed loan drops off the out-now cards, so its evidence — photos, the
    // signed agreement — would be unreachable without the links carried here.
    events.push({
      at: Date.parse(loan.returnedAt),
      tone: "green",
      // Both ends of the fuel reading: the differential is what gets recharged,
      // and an unrecorded fuel_in must read "—" rather than echo fuel_out.
      text: `${loan.carReg} returned by ${loan.customerName} — fuel ${fuelLabel(
        loan.fuelOut,
      )} → ${fuelLabel(loan.fuelIn)}${loan.conditionIn ? `, ${loan.conditionIn}` : ""}`,
      photos: [...loan.photoUrlsIn, ...loan.photoUrlsOut],
      signatureUrl: loan.signatureUrl,
    });
  }
  events.sort((a, b) => b.at - a.at);

  const dayKey = (t: number) => new Date(t).toDateString();
  const todayKey = dayKey(now);
  const yesterdayKey = dayKey(now - DAY_MS);

  const days: DiaryDay[] = [];
  for (const event of events) {
    const key = dayKey(event.at);
    let day = days.find((d) => d.key === key);
    if (!day) {
      day = {
        key,
        today: key === todayKey,
        label:
          key === todayKey
            ? "TODAY"
            : key === yesterdayKey
              ? "YESTERDAY"
              : new Date(event.at)
                  .toLocaleDateString("en-GB", { day: "numeric", month: "short" })
                  .toUpperCase(),
        events: [],
      };
      days.push(day);
    }
    day.events.push(event);
  }
  return days;
}

export function LoansSection({
  loans,
  brandColor,
  onBrand,
}: {
  loans: LoanView[];
  brandColor: string;
  onBrand: string;
}) {
  const [returningId, setReturningId] = useState<string | null>(null);
  const [photosOpenId, setPhotosOpenId] = useState<string | null>(null);
  const [fuelIn, setFuelIn] = useState(8);
  const [returnPhotos, setReturnPhotos] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const now = useClientNow(loans);

  const open = loans.filter((l) => !l.returnedAt);
  const diary = useMemo(() => (now == null ? [] : buildDiary(loans, now)), [loans, now]);

  function openReturn(loan: LoanView) {
    setError(null);
    setReturnPhotos([]);
    setFuelIn(loan.fuelOut ?? 8);
    setReturningId(loan.id);
  }

  function closeReturn() {
    setError(null);
    setReturnPhotos([]);
    setReturningId(null);
  }

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
    <div
      className="grid grid-cols-[1.15fr_1fr] items-start gap-5"
      style={{ "--brand": brandColor, "--brand-hover": lighten(brandColor) } as React.CSSProperties}
    >
      <section className="flex min-w-0 flex-col gap-2.5">
        <h2 className={SECTION_LABEL_CLASS}>Out now — {open.length}</h2>
        {open.length === 0 ? (
          <div className="rounded-[10px] border border-dashed border-ws-border bg-ws-card p-6 text-center text-[13px] text-ws-text-2">
            No cars out on loan — every key is on the board.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {open.map((loan) => {
              const loanedAt = Date.parse(loan.loanedAt);
              const due = loan.dueBackAt ? Date.parse(loan.dueBackAt) : null;
              const overdue = now != null && due != null && due < now;
              const progress =
                now == null
                  ? 0
                  : due == null
                    ? 30
                    : overdue
                      ? 100
                      : Math.min(100, Math.max(4, ((now - loanedAt) / (due - loanedAt)) * 100));
              const meta = [
                `fuel ${fuelLabel(loan.fuelOut)}`,
                ...(loan.odometerOut != null
                  ? [`${loan.odometerOut.toLocaleString("en-GB")} mi out`]
                  : []),
                ...(loan.jobLabel ? [loan.jobLabel] : []),
              ].join(" · ");
              const isReturning = returningId === loan.id;
              const photosOpen = photosOpenId === loan.id;

              return (
                <div
                  key={loan.id}
                  className={`rounded-[10px] border bg-ws-card p-[14px] ${
                    overdue ? "border-ws-red-border" : "border-ws-border"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <PlateChip reg={loan.carReg} size="md" />
                        <span className="text-[13.5px] font-semibold text-ws-text">
                          {loan.customerName}
                        </span>
                        {loan.customerPhone && (
                          <span className="text-[12px] text-ws-text-2">{loan.customerPhone}</span>
                        )}
                      </div>
                      <p className="mt-1.5 text-[11.5px] text-ws-text-2">
                        {meta}
                        {loan.jobId && (
                          <>
                            {" · "}
                            <Link
                              href={`/staff/jobs/${loan.jobId}`}
                              className="underline hover:text-ws-text"
                            >
                              Linked job →
                            </Link>
                          </>
                        )}
                      </p>
                      {loan.conditionOut && (
                        // The damage recorded on the way out is the only thing
                        // the return check has to compare against.
                        <p className="mt-1 text-[11.5px] text-ws-text-2">
                          <span className="text-ws-text-3">Out:</span> {loan.conditionOut}
                        </p>
                      )}
                    </div>
                    {now != null &&
                      (due == null ? (
                        <StatusChip tone="neutral">OPEN-ENDED</StatusChip>
                      ) : overdue ? (
                        <StatusChip tone="red">OVERDUE {agoLabel(now - due)}</StatusChip>
                      ) : (
                        <StatusChip tone="amber">DUE IN {agoLabel(due - now)}</StatusChip>
                      ))}
                  </div>

                  <div className="mt-2.5 h-1.5 overflow-hidden rounded-[3px] bg-ws-hover">
                    <div
                      className={`h-1.5 rounded-[3px] ${overdue ? "bg-ws-red" : "bg-ws-amber"}`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="mt-[5px] flex justify-between font-mono text-[9px] tracking-[0.06em] text-ws-text-3">
                    <span>OUT {now == null ? "" : fmtDateTime(loan.loanedAt).toUpperCase()}</span>
                    <span>DUE {now == null ? "" : fmtDateTime(loan.dueBackAt).toUpperCase()}</span>
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    {loan.signatureUrl && (
                      <EvidenceChip tone="green" href={loan.signatureUrl}>
                        Signed ✓
                      </EvidenceChip>
                    )}
                    {loan.photoUrlsOut.length > 0 && (
                      // A chip linking only to the first photo would strand the
                      // rest, so it expands the full strip instead.
                      <EvidenceChip
                        tone="neutral"
                        onClick={() => setPhotosOpenId(photosOpen ? null : loan.id)}
                        pressed={photosOpen}
                      >
                        {loan.photoUrlsOut.length} photos
                      </EvidenceChip>
                    )}
                    {loan.licenceShareCode && (
                      <EvidenceChip tone="blue">
                        Share {loan.licenceShareCode.toUpperCase()}
                      </EvidenceChip>
                    )}
                    <span className="flex-1" />
                    <button
                      type="button"
                      onClick={() => (isReturning ? closeReturn() : openReturn(loan))}
                      className="inline-flex h-7 flex-none items-center justify-center rounded-lg bg-[#e5e5e5] px-3 text-xs font-semibold text-[#171717] active:translate-y-px"
                    >
                      {isReturning ? "Close" : "Return car"}
                    </button>
                  </div>

                  {photosOpen && (
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {loan.photoUrlsOut.map((url, i) => (
                        <a key={url} href={url} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt={`Condition photo ${i + 1}`}
                            className="h-14 w-14 rounded-md border border-ws-border object-cover"
                          />
                        </a>
                      ))}
                    </div>
                  )}

                  {isReturning && (
                    <form
                      onSubmit={handleReturn}
                      className="mt-3 flex flex-col gap-2.5 border-t border-ws-border pt-3"
                    >
                      <input type="hidden" name="loanId" value={loan.id} />
                      <input type="hidden" name="fuelIn" value={fuelIn} />
                      {loan.conditionOut && (
                        <p className="text-[11px] text-ws-text-2">
                          <span className="font-mono uppercase tracking-[0.12em] text-ws-text-3">
                            At check-out
                          </span>{" "}
                          {loan.conditionOut}
                        </p>
                      )}
                      <div>
                        <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-ws-text-3">
                          Fuel in · {fuelLabel(fuelIn)}
                        </div>
                        <div className="mt-[5px]">
                          <FuelChipPicker
                            value={fuelIn}
                            onChange={setFuelIn}
                            brandColor={brandColor}
                            onBrand={onBrand}
                            size="sm"
                            disabled={pending}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-[1fr_1.6fr] gap-2.5">
                        <label className="block text-[11px] text-ws-text-2">
                          Odometer in
                          <input
                            type="number"
                            name="odometerIn"
                            min={0}
                            className={`${INPUT_CLASS} mt-1`}
                            disabled={pending}
                          />
                        </label>
                        <label className="block text-[11px] text-ws-text-2">
                          Condition / new damage
                          <input
                            name="conditionIn"
                            placeholder="e.g. none — as checked out"
                            className={`${INPUT_CLASS} mt-1`}
                            disabled={pending}
                          />
                        </label>
                      </div>

                      <label className="block text-[11px] text-ws-text-2">
                        Return photos (up to 6)
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          multiple
                          className="mt-1 block w-full text-[12px] text-ws-text-2 file:mr-3 file:rounded-lg file:border-0 file:bg-ws-hover file:px-3 file:py-1.5 file:text-[12px] file:text-ws-text"
                          onChange={(e) =>
                            setReturnPhotos(Array.from(e.target.files ?? []).slice(0, 6))
                          }
                          disabled={pending}
                        />
                        {returnPhotos.length > 0 && (
                          <span className="mt-1 block text-[11px] text-ws-green">
                            {returnPhotos.length} photo{returnPhotos.length === 1 ? "" : "s"} attached
                          </span>
                        )}
                      </label>

                      {error && <p className="text-[12px] text-ws-red">{error}</p>}

                      <div className="flex items-center gap-2">
                        <button
                          type="submit"
                          disabled={pending}
                          style={{ background: "var(--brand)", color: onBrand }}
                          className="inline-flex h-7 items-center justify-center rounded-lg px-3 text-xs font-semibold hover:bg-[var(--brand-hover)] active:translate-y-px disabled:opacity-60"
                        >
                          {pending ? "Saving…" : "Complete return"}
                        </button>
                        <button
                          type="button"
                          onClick={closeReturn}
                          disabled={pending}
                          className="inline-flex h-7 items-center justify-center rounded-lg px-3 text-xs font-medium text-ws-text-2 hover:bg-ws-hover hover:text-ws-text disabled:opacity-60"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="flex min-w-0 flex-col gap-2.5">
        <h2 className={SECTION_LABEL_CLASS}>Diary</h2>
        <div className="rounded-[10px] border border-ws-border bg-ws-card px-4 py-[14px]">
          {/* Nothing until `now` lands: the day buckets are relative to it. */}
          {now == null ? null : diary.length === 0 ? (
            <p className="text-[13px] text-ws-text-2">Nothing in the diary yet.</p>
          ) : (
            diary.map((day) => (
              <div key={day.key} className="pb-0.5 pt-1.5">
                <div
                  className={`font-mono text-[9.5px] font-bold tracking-[0.14em] ${
                    day.today ? "" : "text-ws-text-3"
                  }`}
                  style={day.today ? { color: brandColor } : undefined}
                >
                  {day.label}
                </div>
                <div className="mt-1.5 flex flex-col border-l border-ws-border">
                  {day.events.map((event, i) => (
                    <div
                      key={`${day.key}-${i}`}
                      className="-ml-[4.5px] flex items-start gap-2.5 py-[5px]"
                    >
                      <span
                        className={`mt-1 h-2 w-2 flex-none rounded-full border-2 border-ws-card ${
                          event.tone === "amber" ? "bg-ws-amber" : "bg-ws-green"
                        }`}
                      />
                      <span className="w-[38px] flex-none pt-px font-mono text-[10px] text-ws-text-3">
                        {new Date(event.at).toLocaleTimeString("en-GB", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span className="min-w-0 text-[12.5px] leading-[1.45] text-[#c6cad1]">
                        {event.text}
                        {event.photos.map((url, n) => (
                          <span key={url}>
                            {" "}
                            <EvidenceChip tone="neutral" href={url}>
                              Photo {n + 1}
                            </EvidenceChip>
                          </span>
                        ))}
                        {event.signatureUrl && (
                          <>
                            {" "}
                            <EvidenceChip tone="green" href={event.signatureUrl}>
                              Signed ✓
                            </EvidenceChip>
                          </>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
