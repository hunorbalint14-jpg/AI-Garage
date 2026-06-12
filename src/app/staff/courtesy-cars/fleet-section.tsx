"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { CustomerVehiclePicker } from "@/components/staff/customer-vehicle-picker";
import { addCourtesyCar, setCourtesyCarActive, checkOutCourtesyCar } from "./actions";

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
}: {
  cars: CourtesyCarView[];
  openLoanCarIds: string[];
  agreement: string;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [checkoutCarId, setCheckoutCarId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const onLoan = new Set(openLoanCarIds);

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
      }
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
      if ("error" in result) setError(result.error);
      else setCheckoutCarId(null);
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
          <label className="text-xs text-muted-foreground">
            Registration *
            <input name="registration" className={`${INPUT_CLASS} mt-1`} required disabled={pending} />
          </label>
          <label className="text-xs text-muted-foreground">
            Make
            <input name="make" className={`${INPUT_CLASS} mt-1`} disabled={pending} />
          </label>
          <label className="text-xs text-muted-foreground">
            Model
            <input name="model" className={`${INPUT_CLASS} mt-1`} disabled={pending} />
          </label>
          <label className="text-xs text-muted-foreground">
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

          <CustomerVehiclePicker hideVehicleUntilCustomer customerLabel="Customer *" vehicleLabel="" />

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
