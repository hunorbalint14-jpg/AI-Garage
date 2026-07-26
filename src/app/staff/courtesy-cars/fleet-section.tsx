"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/staff/page-header";
import { CustomerVehiclePicker } from "@/components/staff/customer-vehicle-picker";
import {
  addCourtesyCar,
  setCourtesyCarActive,
  checkOutCourtesyCar,
  prepareLoanPhotoUploads,
  attachLoanPhotos,
  prepareLoanSignatureUpload,
  attachLoanSignature,
} from "./actions";
import { dvlaLookup } from "@/app/staff/customers/actions";
import {
  INPUT_CLASS,
  SECTION_LABEL_CLASS,
  PlateChip,
  FuelChipPicker,
  fuelLabel,
  lighten,
  useClientNow,
} from "./courtesy-ui";
import type { LoanView } from "./loans-section";

// Mint signed URLs, raw-PUT each file, then attach the verified paths.
// Exported for the return flow in loans-section.
export async function uploadLoanPhotos(
  loanId: string,
  direction: "out" | "in",
  files: File[],
): Promise<string | null> {
  if (files.length === 0) return null;
  const prep = await prepareLoanPhotoUploads(
    loanId,
    direction,
    files.map((f) => ({
      mime: f.type,
      size: f.size,
      ext: f.name.split(".").pop() ?? "jpg",
    })),
  );
  if ("error" in prep) return prep.error;

  for (let i = 0; i < prep.uploads.length; i++) {
    const res = await fetch(prep.uploads[i].url, {
      method: "PUT",
      headers: { "Content-Type": files[i].type },
      body: files[i],
    });
    if (!res.ok) return `Photo upload failed (HTTP ${res.status}).`;
  }
  const attach = await attachLoanPhotos(loanId, direction, prep.uploads.map((u) => u.path));
  return "error" in attach ? attach.error : null;
}

// Export the drawn signature as a PNG, mint a signed URL, PUT it, attach the path.
async function uploadLoanSignature(loanId: string, canvas: HTMLCanvasElement): Promise<string | null> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return "Could not capture the signature.";
  const prep = await prepareLoanSignatureUpload(loanId);
  if ("error" in prep) return prep.error;
  const res = await fetch(prep.url, {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: blob,
  });
  if (!res.ok) return `Signature upload failed (HTTP ${res.status}).`;
  const attach = await attachLoanSignature(loanId, prep.path);
  return "error" in attach ? attach.error : null;
}

// Reset the canvas to a crisp, white, blank pad. Sizing the backing store to
// the element box × DPR keeps strokes sharp on tablets; re-running it (on clear)
// also wipes the bitmap since setting canvas.width resets it.
function resetSignatureCanvas(canvas: HTMLCanvasElement): void {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0) return;
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, rect.width, rect.height);
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#111827";
}

// Hand-rolled signature pad (pointer events, no dependency). The parent owns the
// canvas ref so it can toBlob() on submit; onInkChange reports whether anything
// has been drawn so the upload is skipped for an untouched pad.
function SignaturePad({
  canvasRef,
  onInkChange,
  disabled,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  onInkChange: (hasInk: boolean) => void;
  disabled?: boolean;
}) {
  const drawing = useRef(false);
  const inked = useRef(false);

  useEffect(() => {
    if (canvasRef.current) resetSignatureCanvas(canvasRef.current);
  }, [canvasRef]);

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const { x, y } = point(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const { x, y } = point(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!inked.current) {
      inked.current = true;
      onInkChange(true);
    }
  }

  function stop() {
    drawing.current = false;
  }

  function clear() {
    if (canvasRef.current) resetSignatureCanvas(canvasRef.current);
    inked.current = false;
    onInkChange(false);
  }

  return (
    <div className="mt-1">
      <canvas
        ref={canvasRef}
        className="block h-[140px] w-full rounded-[8px] border border-ws-border bg-white"
        style={{ touchAction: "none" }}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
      />
      <button
        type="button"
        onClick={clear}
        disabled={disabled}
        className="mt-1 text-[11px] text-ws-text-2 underline transition-colors hover:text-ws-text disabled:opacity-50"
      >
        Clear signature
      </button>
    </div>
  );
}

export type OpenJobView = { id: string; customerId: string; label: string };

export type CourtesyCarView = {
  id: string;
  registration: string;
  make: string | null;
  model: string | null;
  notes: string | null;
  active: boolean;
};

const DAY_MS = 864e5;
/** 2 days of history, today, 4 days ahead — the diary's fixed 7-day window. */
const WINDOW_DAYS = 7;
const TODAY_INDEX = 2;

const BRAND_BUTTON_CLASS =
  "inline-flex flex-none items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] transition-colors hover:bg-[var(--brand-hover)] active:translate-y-px disabled:opacity-50";
const GHOST_BUTTON_CLASS =
  "inline-flex flex-none items-center justify-center whitespace-nowrap rounded-[8px] text-ws-text-2 transition-colors hover:bg-ws-hover hover:text-ws-text disabled:opacity-50";

type BarTone = "amber" | "red" | "green";

const BAR_TONES: Record<BarTone, string> = {
  amber: "bg-ws-amber-bg border-ws-amber-border text-ws-amber",
  red: "bg-ws-red-bg border-ws-red-border text-ws-red",
  green: "bg-ws-green-bg border-ws-green-border text-ws-green",
};

type Bar = { key: string; left: number; width: number; tone: BarTone; label: string; title: string };

/** Bars are labelled by surname — the lane is only ~1/7 of a week wide. */
function surname(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[parts.length - 1] || name).toUpperCase();
}

const STEPS: { n: number; label: string }[] = [
  { n: 1, label: "WHO" },
  { n: 2, label: "CONDITION" },
  { n: 3, label: "AGREEMENT" },
];

export function FleetSection({
  cars,
  loans,
  openLoanCarIds,
  agreement,
  openJobs,
  brandColor,
  onBrand,
}: {
  cars: CourtesyCarView[];
  loans: LoanView[];
  openLoanCarIds: string[];
  agreement: string;
  openJobs: OpenJobView[];
  brandColor: string;
  onBrand: string;
}) {
  // The board is drawn relative to "now", which differs between the server
  // render and hydration — so the clock is read only after mount and the lanes
  // stay empty (structure only) until then.
  const now = useClientNow(loans);
  const clock = useMemo(() => {
    if (now == null) return null;
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    return { windowStart: startOfToday.getTime() - TODAY_INDEX * DAY_MS, now };
  }, [now]);
  const [manageOpen, setManageOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Add-car form: registration/make/model are controlled so a DVLA lookup can
  // prefill them. Notes stays uncontrolled (form.reset clears it on success).
  const [addReg, setAddReg] = useState("");
  const [addMake, setAddMake] = useState("");
  const [addModel, setAddModel] = useState("");
  const [lookupPending, startLookup] = useTransition();
  const [lookupHint, setLookupHint] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  // Check-out wizard.
  const [wizOpen, setWizOpen] = useState(false);
  const [wizStep, setWizStep] = useState(1);
  const [wizCarId, setWizCarId] = useState<string | null>(null);
  const [wizError, setWizError] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [jobId, setJobId] = useState("");
  const [dueBackAt, setDueBackAt] = useState("");
  const [fuelOut, setFuelOut] = useState(8);
  const [odometerOut, setOdometerOut] = useState("");
  const [shareCode, setShareCode] = useState("");
  const [condition, setCondition] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [agreementName, setAgreementName] = useState("");
  // The picker owns its own search state; remounting it on each open is the
  // only way to clear a previously chosen customer.
  const [wizNonce, setWizNonce] = useState(0);
  // Drawn check-out signature: the canvas lives in SignaturePad; we read it on
  // submit. sigInk gates the upload so an untouched pad is skipped.
  const sigCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [sigInk, setSigInk] = useState(false);

  useEffect(() => {
    if (!wizOpen) return;
    function onKey(e: KeyboardEvent) {
      // A check-out in flight owns the footer error line — don't close over it.
      if (e.key === "Escape" && !pending) setWizOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [wizOpen, pending]);

  const onLoan = useMemo(() => new Set(openLoanCarIds), [openLoanCarIds]);

  const dayCells = useMemo(() => {
    return Array.from({ length: WINDOW_DAYS }, (_, i) => {
      if (!clock) return { label: "", today: false };
      // Midday sample keeps the label on the right day across a DST shift.
      const d = new Date(clock.windowStart + i * DAY_MS + 12 * 36e5);
      const today = i === TODAY_INDEX;
      return {
        label:
          d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" }).toUpperCase() +
          (today ? " · TODAY" : ""),
        today,
      };
    });
  }, [clock]);

  const lanes = useMemo(() => {
    if (!clock) return cars.map((car) => ({ car, bars: [] as Bar[] }));
    const span = WINDOW_DAYS * DAY_MS;
    const pct = (t: number) => Math.max(0, Math.min(100, ((t - clock.windowStart) / span) * 100));
    return cars.map((car) => {
      const bars: Bar[] = [];
      for (const loan of loans) {
        if (loan.carId !== car.id) continue;
        const start = pct(new Date(loan.loanedAt).getTime());
        const label = surname(loan.customerName);
        const title = `${loan.customerName} — out ${new Date(loan.loanedAt).toLocaleString("en-GB")}`;
        if (loan.returnedAt) {
          const end = pct(new Date(loan.returnedAt).getTime());
          // A loan that finished before the window opened collapses onto 0%.
          if (end > 0.5) {
            bars.push({
              key: loan.id,
              left: start,
              width: Math.max(2, end - start),
              tone: "green",
              label,
              title,
            });
          }
          continue;
        }
        const due = loan.dueBackAt ? new Date(loan.dueBackAt).getTime() : clock.now;
        const duePct = pct(due);
        bars.push({
          key: loan.id,
          left: start,
          width: Math.max(2, duePct - start),
          tone: "amber",
          label,
          title,
        });
        if (due < clock.now) {
          bars.push({
            key: `${loan.id}-overdue`,
            left: duePct,
            width: Math.max(1.5, pct(clock.now) - duePct),
            tone: "red",
            label: "OVERDUE",
            title: `${loan.customerName} — overdue since ${new Date(due).toLocaleString("en-GB")}`,
          });
        }
      }
      return { car, bars };
    });
  }, [cars, loans, clock]);

  const nowLeft = clock
    ? Math.max(0, Math.min(100, ((clock.now - clock.windowStart) / (WINDOW_DAYS * DAY_MS)) * 100))
    : 0;

  const availableCars = cars.filter((c) => c.active && !onLoan.has(c.id));
  const wizCar = cars.find((c) => c.id === wizCarId) ?? null;
  // Picking a car collapses the list to that one; clicking it again reopens it.
  const wizCars = wizCar ? [wizCar] : availableCars;
  const customerJobs = picked ? openJobs.filter((j) => j.customerId === picked.id) : [];

  function openWizard(carId: string | null) {
    setWizOpen(true);
    setWizStep(1);
    setWizCarId(carId);
    setWizError(null);
    setPicked(null);
    setJobId("");
    setDueBackAt("");
    setFuelOut(8);
    setOdometerOut("");
    setShareCode("");
    setCondition("");
    setPhotos([]);
    setAgreementName("");
    setSigInk(false);
    setWizNonce((n) => n + 1);
  }

  function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const formData = new FormData(form);
    startTransition(async () => {
      const result = await addCourtesyCar(formData);
      if ("error" in result) setError(result.error);
      else {
        form.reset();
        setAddReg("");
        setAddMake("");
        setAddModel("");
        setLookupHint(null);
        setLookupError(null);
      }
    });
  }

  // Prefill make/model from the DVLA lookup by registration (same wrapper the
  // customer vehicle form uses). Road tax isn't relevant for a courtesy car,
  // so we skip the VED call.
  function handleAddLookup() {
    const reg = addReg.trim();
    if (!reg) return;
    setLookupError(null);
    setLookupHint(null);
    startLookup(async () => {
      const result = await dvlaLookup(reg);
      if ("error" in result) {
        setLookupError(result.error);
        return;
      }
      const v = result.vehicle;
      if (v.make) setAddMake(v.make);
      if (v.model) setAddModel(v.model);
      const filled = [v.make, v.model, v.year].filter(Boolean);
      setLookupHint(`Found: ${filled.join(", ") || "vehicle exists"}.`);
    });
  }

  function handleToggleActive(carId: string, active: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await setCourtesyCarActive(carId, active);
      if ("error" in result) setError(result.error);
    });
  }

  function handleCheckout() {
    setWizError(null);
    const formData = new FormData();
    formData.set("carId", wizCarId ?? "");
    formData.set("customerId", picked?.id ?? "");
    formData.set("jobId", jobId);
    formData.set("dueBackAt", dueBackAt);
    formData.set("fuelOut", String(fuelOut));
    formData.set("odometerOut", odometerOut);
    formData.set("conditionOut", condition);
    formData.set("licenceShareCode", shareCode);
    formData.set("agreementName", agreementName);
    startTransition(async () => {
      const result = await checkOutCourtesyCar(formData);
      if ("error" in result) {
        setWizError(result.error);
        return;
      }
      // Loan exists; photos and signature are best-effort on top.
      if (photos.length > 0) {
        const photoError = await uploadLoanPhotos(result.loanId, "out", photos);
        if (photoError) {
          setWizError(`Checked out, but photos failed: ${photoError}`);
          return;
        }
      }
      if (sigInk && sigCanvasRef.current) {
        const sigError = await uploadLoanSignature(result.loanId, sigCanvasRef.current);
        if (sigError) {
          setWizError(`Checked out, but signature failed: ${sigError}`);
          return;
        }
      }
      setWizOpen(false);
      setWizCarId(null);
      setPicked(null);
      setPhotos([]);
      setAgreementName("");
      setSigInk(false);
    });
  }

  function handleNext() {
    if (wizStep === 1) {
      if (!wizCar || !picked) {
        setWizError("Pick a car and a customer.");
        return;
      }
      setWizStep(2);
      setWizError(null);
      return;
    }
    if (wizStep === 2) {
      setWizStep(3);
      setWizError(null);
      return;
    }
    if (!agreementName.trim()) {
      setWizError("The customer must sign by typing their full name.");
      return;
    }
    handleCheckout();
  }

  return (
    <div
      style={
        { "--brand": brandColor, "--brand-hover": lighten(brandColor) } as React.CSSProperties
      }
    >
      <PageHeader
        title="Courtesy cars"
        description="One diary for the whole fleet — who has what, when it's due back, and the paper trail for every loan."
        action={
          <button
            type="button"
            onClick={() => openWizard(null)}
            className={`${BRAND_BUTTON_CLASS} h-8 px-[14px] text-sm font-semibold`}
            style={{ background: "var(--brand)", color: onBrand }}
          >
            <Plus className="h-[14px] w-[14px]" strokeWidth={2.5} />
            New loan
          </button>
        }
      />

      <section className="rounded-[12px] border border-ws-border bg-ws-card px-[18px] py-4">
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h2 className={SECTION_LABEL_CLASS}>Loan diary — this week</h2>
            {/* Adding a car and taking one off the fleet live here — this is
                the only route to them, so it has to read as a button. */}
            <button
              type="button"
              onClick={() => setManageOpen((v) => !v)}
              className="inline-flex items-center gap-1 self-center rounded-md border border-ws-border px-2 py-[3px] text-[11px] font-medium text-ws-text-2 transition-colors hover:border-ws-text-3 hover:text-ws-text"
            >
              {manageOpen ? (
                "Hide fleet"
              ) : (
                <>
                  <Plus className="h-3 w-3" strokeWidth={2.5} />
                  Add or edit cars
                </>
              )}
            </button>
          </div>
          <div className="flex gap-3 font-mono text-[9px] tracking-[0.08em] text-ws-text-3">
            <span className="inline-flex items-center gap-[5px]">
              <span className="h-2 w-2 rounded-[2px] border border-ws-amber-border bg-ws-amber-bg" />
              ON LOAN
            </span>
            <span className="inline-flex items-center gap-[5px]">
              <span className="h-2 w-2 rounded-[2px] border border-ws-red-border bg-ws-red-bg" />
              OVERDUE
            </span>
            <span className="inline-flex items-center gap-[5px]">
              <span className="h-2 w-2 rounded-[2px] border border-ws-green-border bg-ws-green-bg" />
              RETURNED
            </span>
          </div>
        </div>

        {error && <p className="mt-3 text-[12px] text-ws-red">{error}</p>}

        {manageOpen && (
          <div className="mt-3 flex flex-col gap-3 rounded-[10px] border border-ws-border bg-ws-page p-3">
            <form onSubmit={handleAdd} className="grid gap-3 sm:grid-cols-4">
              <label className="text-[11px] text-ws-text-2 sm:col-span-2">
                Registration *
                <div className="mt-1 flex gap-2">
                  <input
                    name="registration"
                    className={`${INPUT_CLASS} font-mono uppercase`}
                    required
                    disabled={pending}
                    placeholder="AB12 CDE"
                    autoComplete="off"
                    value={addReg}
                    onChange={(e) => {
                      setAddReg(e.target.value.toUpperCase());
                      setLookupHint(null);
                      setLookupError(null);
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!addReg.trim() || pending}
                    loading={lookupPending}
                    onClick={handleAddLookup}
                  >
                    Look up
                  </Button>
                </div>
                {lookupHint && <span className="mt-1 block text-[11px] text-ws-green">{lookupHint}</span>}
                {lookupError && <span className="mt-1 block text-[11px] text-ws-red">{lookupError}</span>}
              </label>
              <label className="text-[11px] text-ws-text-2">
                Make
                <input
                  name="make"
                  className={`${INPUT_CLASS} mt-1`}
                  disabled={pending}
                  value={addMake}
                  onChange={(e) => setAddMake(e.target.value)}
                />
              </label>
              <label className="text-[11px] text-ws-text-2">
                Model
                <input
                  name="model"
                  className={`${INPUT_CLASS} mt-1`}
                  disabled={pending}
                  value={addModel}
                  onChange={(e) => setAddModel(e.target.value)}
                />
              </label>
              <label className="text-[11px] text-ws-text-2 sm:col-span-4">
                Notes
                <input name="notes" className={`${INPUT_CLASS} mt-1`} disabled={pending} />
              </label>
              <div className="sm:col-span-4">
                <button
                  type="submit"
                  disabled={pending}
                  className={`${BRAND_BUTTON_CLASS} h-7 px-3 text-[12px] font-semibold`}
                  style={{ background: "var(--brand)", color: onBrand }}
                >
                  {pending ? "Saving…" : "Add courtesy car"}
                </button>
              </div>
            </form>

            {cars.length > 0 && (
              <div className="flex flex-col gap-1 border-t border-ws-border pt-3">
                {cars.map((car) => (
                  <div key={car.id} className="flex items-center gap-2 py-[3px]">
                    <PlateChip reg={car.registration} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-[11px] text-ws-text-3">
                      {[car.make, car.model].filter(Boolean).join(" ") || "—"}
                      {/* The board lane has no room for notes, so this is the
                          only place the field staff type is read back. */}
                      {car.notes && <span className="text-ws-text-2"> · {car.notes}</span>}
                    </span>
                    {onLoan.has(car.id) && (
                      <span className="font-mono text-[8.5px] tracking-[0.08em] text-ws-amber">ON LOAN</span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleToggleActive(car.id, !car.active)}
                      disabled={pending || onLoan.has(car.id)}
                      className={`${GHOST_BUTTON_CLASS} h-6 px-2 text-[11px] font-medium`}
                    >
                      {car.active ? "Deactivate" : "Reactivate"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {cars.length === 0 ? (
          <div className="my-2 rounded-[10px] border border-dashed border-ws-border p-5 text-center">
            <p className="text-[13px] text-ws-text-2">
              No courtesy cars yet — add your first one to start the loan diary.
            </p>
            {!manageOpen && (
              <Button size="sm" variant="outline" className="mt-3" onClick={() => setManageOpen(true)}>
                <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                Add a courtesy car
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-[168px_minmax(0,1fr)] items-center gap-x-3">
              <div />
              <div className="flex">
                {dayCells.map((d, i) => (
                  <div
                    key={i}
                    className={`flex-1 pb-1.5 font-mono text-[9.5px] tracking-[0.08em] ${
                      d.today ? "font-bold" : "font-medium text-ws-text-3"
                    }`}
                    style={d.today ? { color: "var(--brand)" } : undefined}
                  >
                    {/* Labels arrive only after the client clock is read; the
                        NBSP keeps the header row's height stable until then. */}
                    {d.label || "\u00A0"}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-[6px]">
              {lanes.map(({ car, bars }) => (
                <div
                  key={car.id}
                  className="grid grid-cols-[168px_minmax(0,1fr)] items-center gap-x-3"
                  style={car.active ? undefined : { opacity: 0.45 }}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <PlateChip reg={car.registration} size="sm" />
                    <span className="min-w-0 truncate text-[10.5px] text-ws-text-3">
                      {[car.make, car.model].filter(Boolean).join(" ") || "—"}
                    </span>
                    {car.active && !onLoan.has(car.id) && (
                      <button
                        type="button"
                        title="Check out this car"
                        onClick={() => openWizard(car.id)}
                        className="grid h-5 w-5 flex-none place-items-center rounded-[6px] border border-ws-border text-ws-text-3 transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]"
                      >
                        <Plus className="h-[11px] w-[11px]" strokeWidth={2.5} />
                      </button>
                    )}
                    {!car.active && (
                      <span className="flex-none rounded border border-ws-border px-[5px] py-px font-mono text-[8.5px] tracking-[0.08em] text-ws-text-3">
                        OFF FLEET
                      </span>
                    )}
                  </div>
                  <div
                    className="relative h-[34px] overflow-hidden rounded-[6px] bg-[#101317]"
                    style={{
                      backgroundImage: "linear-gradient(90deg,#1c2026 1px,transparent 1px)",
                      backgroundSize: "calc(100%/7) 100%",
                    }}
                  >
                    <div
                      className="absolute inset-y-0"
                      style={{
                        left: "calc(2 / 7 * 100%)",
                        width: "calc(100% / 7)",
                        background: "color-mix(in srgb, var(--brand) 7%, transparent)",
                      }}
                    />
                    {bars.map((bar) => (
                      <div
                        key={bar.key}
                        title={bar.title}
                        className={`absolute bottom-[5px] top-[5px] flex items-center overflow-hidden whitespace-nowrap rounded-[4px] border px-[6px] font-mono text-[9px] font-semibold tracking-[0.05em] ${BAR_TONES[bar.tone]}`}
                        style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
                      >
                        {bar.label}
                      </div>
                    ))}
                    {clock && (
                      <div
                        className="absolute inset-y-0 w-[2px]"
                        style={{ left: `${nowLeft}%`, background: "var(--brand)" }}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {wizOpen && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close"
            disabled={pending}
            onClick={() => setWizOpen(false)}
            className="animate-co-fade-in absolute inset-0 h-full w-full cursor-default bg-black/60"
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-label="New courtesy car loan"
              className="animate-co-pop-in pointer-events-auto flex max-h-[88vh] w-[640px] max-w-[94vw] flex-col rounded-[14px] border border-ws-border bg-ws-card shadow-[0_32px_80px_rgba(0,0,0,0.6)]"
            >
              <div className="flex items-center justify-between gap-2 border-b border-ws-border px-5 pb-3 pt-4">
                <div>
                  <div className="font-mono text-[10px] tracking-[0.2em] text-ws-text-3">{"// NEW LOAN"}</div>
                  <div className="mt-[3px] text-[16px] font-bold">
                    {wizCar ? `Check out ${wizCar.registration}` : "Check out a courtesy car"}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Close"
                  disabled={pending}
                  onClick={() => setWizOpen(false)}
                  className="grid h-[30px] w-[30px] place-items-center rounded-[8px] text-ws-text-2 transition-colors hover:bg-ws-hover hover:text-ws-text disabled:opacity-50"
                >
                  <X className="h-[15px] w-[15px]" strokeWidth={2} />
                </button>
              </div>

              <div className="flex gap-1.5 px-5 pt-3">
                {STEPS.map(({ n, label }) => {
                  const active = wizStep === n;
                  const done = wizStep > n;
                  return (
                    <div key={n} className="flex-1">
                      <div
                        className={`font-mono text-[9.5px] font-bold tracking-[0.12em] ${
                          active ? "" : done ? "text-ws-green" : "text-ws-text-3"
                        }`}
                        style={active ? { color: "var(--brand)" } : undefined}
                      >
                        0{n} {label}
                      </div>
                      <div
                        className={`mt-[5px] h-[2px] rounded-[1px] ${
                          active ? "" : done ? "bg-ws-green-border" : "bg-[#22262e]"
                        }`}
                        style={active ? { background: "var(--brand)" } : undefined}
                      />
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-[18px]">
                {wizStep === 1 && (
                  <>
                    <div>
                      <div className="mb-1.5 text-[12px] text-ws-text-2">Which car is going out?</div>
                      <div className="flex flex-wrap gap-2">
                        {wizCars.map((car) => {
                          const selected = wizCarId === car.id;
                          return (
                            <button
                              key={car.id}
                              type="button"
                              onClick={() => setWizCarId(selected ? null : car.id)}
                              className={`inline-flex flex-col items-start gap-[3px] rounded-[8px] border px-2.5 py-2 text-left transition-colors ${
                                selected ? "" : "border-ws-border bg-ws-page hover:border-ws-text-3"
                              }`}
                              style={
                                selected
                                  ? {
                                      borderColor: "var(--brand)",
                                      background: "color-mix(in srgb, var(--brand) 12%, transparent)",
                                    }
                                  : undefined
                              }
                            >
                              <PlateChip reg={car.registration} />
                              <span className="text-[11px] text-ws-text-2">
                                {[car.make, car.model].filter(Boolean).join(" ") || "—"}
                              </span>
                            </button>
                          );
                        })}
                        {wizCars.length === 0 && (
                          <p className="text-[12px] text-ws-text-2">
                            Every active car is already out on loan.
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <span className="text-[12px] text-ws-text-2">Who is taking it?</span>
                      <CustomerVehiclePicker
                        key={wizNonce}
                        hideVehicleUntilCustomer
                        customerLabel=""
                        vehicleLabel=""
                        disabled={pending}
                        onCustomerChange={(c) => {
                          setPicked(c ? { id: c.id, name: c.full_name ?? "Customer" } : null);
                          // Jobs are the previous customer's — never post a stale link.
                          setJobId("");
                        }}
                      />
                    </div>

                    {customerJobs.length > 0 && (
                      <label className="block text-[11px] text-ws-text-2">
                        Linked job (optional)
                        <select
                          className={`${INPUT_CLASS} mt-1`}
                          value={jobId}
                          onChange={(e) => setJobId(e.target.value)}
                          disabled={pending}
                        >
                          <option value="">No linked job</option>
                          {customerJobs.map((j) => (
                            <option key={j.id} value={j.id}>
                              {j.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}

                    <div className="grid grid-cols-2 gap-2.5">
                      <label className="block text-[11px] text-ws-text-2">
                        Due back
                        <input
                          type="datetime-local"
                          className={`${INPUT_CLASS} mt-1`}
                          value={dueBackAt}
                          onChange={(e) => setDueBackAt(e.target.value)}
                          disabled={pending}
                        />
                      </label>
                      <label className="block text-[11px] text-ws-text-2">
                        DVLA licence share code
                        <input
                          className={`${INPUT_CLASS} mt-1 font-mono uppercase`}
                          placeholder="From gov.uk/view-driving-licence"
                          value={shareCode}
                          onChange={(e) => setShareCode(e.target.value)}
                          disabled={pending}
                        />
                      </label>
                    </div>
                  </>
                )}

                {wizStep === 2 && (
                  <>
                    <div>
                      <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-ws-text-3">
                        Fuel out · {fuelLabel(fuelOut)}
                      </div>
                      <div className="mt-1.5">
                        <FuelChipPicker
                          value={fuelOut}
                          onChange={setFuelOut}
                          brandColor={brandColor}
                          onBrand={onBrand}
                          size="md"
                          disabled={pending}
                        />
                      </div>
                    </div>
                    <label className="block text-[11px] text-ws-text-2">
                      Odometer out
                      <input
                        type="number"
                        min={0}
                        className={`${INPUT_CLASS} mt-1 w-[180px]`}
                        value={odometerOut}
                        onChange={(e) => setOdometerOut(e.target.value)}
                        disabled={pending}
                      />
                    </label>
                    <label className="block text-[11px] text-ws-text-2">
                      Condition / existing damage
                      <textarea
                        rows={3}
                        className={`${INPUT_CLASS} mt-1 resize-none`}
                        placeholder="e.g. scuff on rear bumper, nearside"
                        value={condition}
                        onChange={(e) => setCondition(e.target.value)}
                        disabled={pending}
                      />
                    </label>
                    <label className="block text-[11px] text-ws-text-2">
                      Condition photos (up to 6)
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        className="mt-1 block w-full text-[13px] text-ws-text file:mr-3 file:rounded-md file:border-0 file:bg-ws-hover file:px-3 file:py-1.5 file:text-[11px] file:text-ws-text-2"
                        onChange={(e) => setPhotos(Array.from(e.target.files ?? []).slice(0, 6))}
                        disabled={pending}
                      />
                      {photos.length > 0 && (
                        <span className="mt-1 block text-[11px] text-ws-green">
                          {photos.length} photo{photos.length === 1 ? "" : "s"} ready to attach
                        </span>
                      )}
                    </label>
                  </>
                )}

                {wizStep === 3 && (
                  <>
                    <div className="rounded-[8px] border border-ws-border bg-ws-page p-3">
                      <p className="text-[11.5px] leading-[1.55] text-ws-text-2">{agreement}</p>
                    </div>
                    <label className="block text-[11px] text-ws-text-2">
                      Customer signs by typing their full name *
                      <input
                        className={`${INPUT_CLASS} mt-1`}
                        value={agreementName}
                        onChange={(e) => setAgreementName(e.target.value)}
                        disabled={pending}
                      />
                    </label>
                    <div className="text-[11px] text-ws-text-2">
                      Signature (sign with finger or stylus)
                      <SignaturePad canvasRef={sigCanvasRef} onInkChange={setSigInk} disabled={pending} />
                    </div>
                  </>
                )}
              </div>

              <div className="flex flex-col gap-2 border-t border-ws-border px-5 py-3.5">
                {wizError && <p className="text-[12px] text-ws-red">{wizError}</p>}
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-mono text-[10.5px] text-ws-text-3">
                    {(wizCar?.registration ?? "PICK A CAR") +
                      " → " +
                      (picked ? picked.name.toUpperCase() : "PICK A CUSTOMER")}
                  </span>
                  <div className="flex flex-none gap-2">
                    {wizStep > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          setWizStep(wizStep - 1);
                          setWizError(null);
                        }}
                        disabled={pending}
                        className={`${GHOST_BUTTON_CLASS} h-8 px-3 text-[13px] font-medium`}
                      >
                        Back
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleNext}
                      disabled={pending}
                      className={`${BRAND_BUTTON_CLASS} h-8 px-[14px] text-[13px] font-semibold`}
                      style={{ background: "var(--brand)", color: onBrand }}
                    >
                      {pending ? "Saving…" : wizStep === 3 ? "Complete check-out" : "Next"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
