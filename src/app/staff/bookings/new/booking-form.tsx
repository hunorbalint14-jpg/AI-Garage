"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createBooking } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Customer = { id: string; full_name: string | null; email: string | null; phone: string | null };
type Vehicle = { id: string; customer_id: string; registration: string; make: string | null; model: string | null };

const TYPE_DEFAULTS: Record<string, number> = {
  mot: 60,
  service: 90,
  repair: 120,
  diagnostic: 60,
  other: 60,
};

function defaultDateTime(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
}

export function BookingForm({
  customers,
  vehicles,
  defaultCustomerId,
  defaultVehicleId,
}: {
  customers: Customer[];
  vehicles: Vehicle[];
  defaultCustomerId: string | null;
  defaultVehicleId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [customerId, setCustomerId] = useState(defaultCustomerId ?? "");
  const [vehicleId, setVehicleId] = useState(defaultVehicleId ?? "");
  const [type, setType] = useState("service");
  const [duration, setDuration] = useState(90);

  const customerVehicles = useMemo(
    () => vehicles.filter((v) => v.customer_id === customerId),
    [vehicles, customerId],
  );

  function handleTypeChange(t: string) {
    setType(t);
    if (TYPE_DEFAULTS[t]) setDuration(TYPE_DEFAULTS[t]);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createBooking(formData);
      if ("error" in result) {
        setError(result.error);
      } else {
        router.push(`/staff/bookings/${result.bookingId}`);
      }
    });
  }

  const inputClass = "w-full rounded-md border border-black/20 dark:border-white/25 bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border p-6 flex flex-col gap-4 max-w-2xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="customerId">Customer</Label>
          <select
            id="customerId"
            name="customerId"
            value={customerId}
            onChange={(e) => { setCustomerId(e.target.value); setVehicleId(""); }}
            required
            disabled={pending}
            className={inputClass}
          >
            <option value="">— Select customer —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.full_name ?? "Unnamed"}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="vehicleId">Vehicle</Label>
          <select
            id="vehicleId"
            name="vehicleId"
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            disabled={pending || !customerId}
            className={inputClass}
          >
            <option value="">— No vehicle —</option>
            {customerVehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.registration}
                {v.make || v.model ? ` — ${[v.make, v.model].filter(Boolean).join(" ")}` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="scheduledAt">Date & time</Label>
          <Input
            id="scheduledAt"
            name="scheduledAt"
            type="datetime-local"
            defaultValue={defaultDateTime()}
            required
            disabled={pending}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="durationMinutes">Duration (min)</Label>
          <Input
            id="durationMinutes"
            name="durationMinutes"
            type="number"
            min={15}
            max={480}
            step={15}
            value={duration}
            onChange={(e) => setDuration(parseInt(e.target.value, 10) || 60)}
            required
            disabled={pending}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="type">Type</Label>
        <select
          id="type"
          name="type"
          value={type}
          onChange={(e) => handleTypeChange(e.target.value)}
          required
          disabled={pending}
          className={inputClass}
        >
          <option value="mot">MOT</option>
          <option value="service">Service</option>
          <option value="repair">Repair</option>
          <option value="diagnostic">Diagnostic</option>
          <option value="other">Other</option>
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="notes">Notes</Label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          placeholder="Optional notes about this appointment"
          disabled={pending}
          className={inputClass + " resize-none"}
        />
      </div>

      <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
        <input type="checkbox" name="sendConfirmation" defaultChecked disabled={pending} />
        Send confirmation to customer (email + SMS)
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={pending || !customerId}>
          {pending ? "Creating…" : "Create booking"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          nativeButton={false}
          render={<a href="/staff/bookings">Cancel</a>}
        />
      </div>
    </form>
  );
}
