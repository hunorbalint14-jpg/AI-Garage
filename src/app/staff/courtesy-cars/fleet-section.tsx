"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { CustomerVehiclePicker } from "@/components/staff/customer-vehicle-picker";
import {
  addCourtesyCar,
  setCourtesyCarActive,
  checkOutCourtesyCar,
  prepareLoanPhotoUploads,
  attachLoanPhotos,
} from "./actions";
import { dvlaLookup } from "@/app/staff/customers/actions";

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

export type OpenJobView = { id: string; customerId: string; label: string };

const INPUT_CLASS =
  "w-full rounded-md border border-black/20 dark:border-white/25 bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

const FUEL_LABELS = ["Empty", "1/8", "1/4", "3/8", "1/2", "5/8", "3/4", "7/8", "Full"];

export type CourtesyCarView = {
  id: string;
  registration: string;
  make: string | null;
  model: string | null;
  notes: string | null;
  active: boolean;
};

export function FleetSection({
  cars,
  openLoanCarIds,
  agreement,
  openJobs,
}: {
  cars: CourtesyCarView[];
  openLoanCarIds: string[];
  agreement: string;
  openJobs: OpenJobView[];
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [checkoutCarId, setCheckoutCarId] = useState<string | null>(null);
  const [pickedCustomerId, setPickedCustomerId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
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
  const onLoan = new Set(openLoanCarIds);
  const customerJobs = pickedCustomerId
    ? openJobs.filter((j) => j.customerId === pickedCustomerId)
    : [];

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
        setShowAdd(false);
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

  function handleCheckout(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await checkOutCourtesyCar(formData);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      // Loan exists; photos are best-effort on top.
      if (photos.length > 0) {
        const photoError = await uploadLoanPhotos(result.loanId, "out", photos);
        if (photoError) {
          setError(`Checked out, but photos failed: ${photoError}`);
          return;
        }
      }
      setCheckoutCarId(null);
      setPhotos([]);
      setPickedCustomerId(null);
    });
  }

  const checkoutCar = cars.find((c) => c.id === checkoutCarId) ?? null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Fleet
        </h2>
        <Button size="sm" variant="outline" onClick={() => setShowAdd((v) => !v)}>
          {showAdd ? "Close" : "Add car"}
        </Button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {showAdd && (
        <form onSubmit={handleAdd} className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-4">
          <label className="text-xs text-muted-foreground sm:col-span-2">
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
            {lookupHint && <span className="mt-1 block text-xs text-green-700">{lookupHint}</span>}
            {lookupError && <span className="mt-1 block text-xs text-red-600">{lookupError}</span>}
          </label>
          <label className="text-xs text-muted-foreground">
            Make
            <input
              name="make"
              className={`${INPUT_CLASS} mt-1`}
              disabled={pending}
              value={addMake}
              onChange={(e) => setAddMake(e.target.value)}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            Model
            <input
              name="model"
              className={`${INPUT_CLASS} mt-1`}
              disabled={pending}
              value={addModel}
              onChange={(e) => setAddModel(e.target.value)}
            />
          </label>
          <label className="text-xs text-muted-foreground sm:col-span-4">
            Notes
            <input name="notes" className={`${INPUT_CLASS} mt-1`} disabled={pending} />
          </label>
          <div className="sm:col-span-4">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Add courtesy car"}
            </Button>
          </div>
        </form>
      )}

      {cars.length === 0 && !showAdd && (
        <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
          No courtesy cars yet — add your first one to start the loan diary.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cars.map((car) => {
          const out = onLoan.has(car.id);
          return (
            <div key={car.id} className={`rounded-lg border bg-card p-4 ${car.active ? "" : "opacity-60"}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-mono font-semibold">{car.registration}</p>
                  <p className="text-xs text-muted-foreground">
                    {[car.make, car.model].filter(Boolean).join(" ") || "—"}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    !car.active
                      ? "bg-gray-100 text-gray-600"
                      : out
                        ? "bg-amber-100 text-amber-700"
                        : "bg-green-100 text-green-700"
                  }`}
                >
                  {!car.active ? "Inactive" : out ? "On loan" : "Available"}
                </span>
              </div>
              {car.notes && <p className="mt-2 text-xs text-muted-foreground">{car.notes}</p>}
              <div className="mt-3 flex gap-2">
                {car.active && !out && (
                  <Button size="sm" onClick={() => setCheckoutCarId(car.id)} disabled={pending}>
                    Check out
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleToggleActive(car.id, !car.active)}
                  disabled={pending || out}
                >
                  {car.active ? "Deactivate" : "Reactivate"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {checkoutCar && (
        <form onSubmit={handleCheckout} className="flex flex-col gap-3 rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              Check out {checkoutCar.registration}
            </h3>
            <Button size="sm" variant="ghost" type="button" onClick={() => setCheckoutCarId(null)}>
              Close
            </Button>
          </div>
          <input type="hidden" name="carId" value={checkoutCar.id} />

          <CustomerVehiclePicker
            hideVehicleUntilCustomer
            customerLabel="Customer *"
            vehicleLabel=""
            onCustomerChange={(c) => setPickedCustomerId(c?.id ?? null)}
          />

          {customerJobs.length > 0 && (
            <label className="text-xs text-muted-foreground">
              Linked job (optional)
              <select name="jobId" className={`${INPUT_CLASS} mt-1`} defaultValue="" disabled={pending}>
                <option value="">No linked job</option>
                {customerJobs.map((j) => (
                  <option key={j.id} value={j.id}>{j.label}</option>
                ))}
              </select>
            </label>
          )}

          <div className="grid gap-3 sm:grid-cols-4">
            <label className="text-xs text-muted-foreground">
              Due back
              <input type="datetime-local" name="dueBackAt" className={`${INPUT_CLASS} mt-1`} disabled={pending} />
            </label>
            <label className="text-xs text-muted-foreground">
              Fuel out *
              <select name="fuelOut" className={`${INPUT_CLASS} mt-1`} defaultValue="8" disabled={pending}>
                {FUEL_LABELS.map((label, i) => (
                  <option key={i} value={i}>{label}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted-foreground">
              Odometer out
              <input type="number" name="odometerOut" min={0} className={`${INPUT_CLASS} mt-1`} disabled={pending} />
            </label>
            <label className="text-xs text-muted-foreground">
              Licence share code
              <input
                name="licenceShareCode"
                className={`${INPUT_CLASS} mt-1 uppercase`}
                placeholder="From gov.uk/view-driving-licence"
                disabled={pending}
              />
            </label>
          </div>

          <label className="text-xs text-muted-foreground">
            Condition / existing damage
            <textarea name="conditionOut" rows={2} className={`${INPUT_CLASS} mt-1 resize-none`} disabled={pending} />
          </label>

          <label className="text-xs text-muted-foreground">
            Condition photos (up to 6)
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="mt-1 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-xs"
              onChange={(e) => setPhotos(Array.from(e.target.files ?? []).slice(0, 6))}
              disabled={pending}
            />
            {photos.length > 0 && (
              <span className="mt-1 block text-xs">{photos.length} photo{photos.length === 1 ? "" : "s"} selected</span>
            )}
          </label>

          <div className="rounded-md border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">{agreement}</p>
            <label className="mt-2 block text-xs text-muted-foreground">
              Customer signs by typing their full name *
              <input name="agreementName" className={`${INPUT_CLASS} mt-1`} required disabled={pending} />
            </label>
          </div>

          <div>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Complete check-out"}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
