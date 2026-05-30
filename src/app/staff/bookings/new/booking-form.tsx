"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createBooking } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Customer = { id: string; full_name: string | null; email: string | null; phone: string | null };
type Vehicle = { id: string; customer_id: string; registration: string; make: string | null; model: string | null };
type Service = { id: string; name: string; category: string; duration_minutes: number; price: number | null };
type Bay = { id: string; name: string; description: string | null };

const FALLBACK_TYPES: { value: string; label: string; duration: number }[] = [
  { value: "mot", label: "MOT", duration: 60 },
  { value: "service", label: "Service", duration: 90 },
  { value: "repair", label: "Repair", duration: 120 },
  { value: "diagnostic", label: "Diagnostic", duration: 60 },
  { value: "other", label: "Other", duration: 60 },
];

function fmt(n: number | null) {
  if (n === null) return "";
  return ` — £${n.toFixed(2)}`;
}

// Default value for the datetime-local input. With a `?date=YYYY-MM-DD` param
// (e.g. from the calendar day panel) use that day at 09:00; otherwise tomorrow
// at 09:00.
function defaultDateTime(dateParam?: string | null): string {
  const d = new Date();
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateParam ?? "");
  if (ymd) {
    d.setFullYear(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
  } else {
    d.setDate(d.getDate() + 1);
  }
  d.setHours(9, 0, 0, 0);
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
}

export function BookingForm({
  customers,
  vehicles,
  services,
  bays,
  defaultCustomerId,
  defaultVehicleId,
}: {
  customers: Customer[];
  vehicles: Vehicle[];
  services: Service[];
  bays: Bay[];
  defaultCustomerId: string | null;
  defaultVehicleId: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const initialDateTime = useMemo(
    () => defaultDateTime(searchParams.get("date")),
    [searchParams],
  );

  const [customerId, setCustomerId] = useState(defaultCustomerId ?? "");
  const [vehicleId, setVehicleId] = useState(defaultVehicleId ?? "");
  const firstService = services[0];
  const [type, setType] = useState(firstService?.name ?? "service");
  const [duration, setDuration] = useState(firstService?.duration_minutes ?? 90);

  const customerVehicles = useMemo(
    () => vehicles.filter((v) => v.customer_id === customerId),
    [vehicles, customerId],
  );

  function handleTypeChange(t: string) {
    setType(t);
    const svc = services.find((s) => s.name === t);
    if (svc) {
      setDuration(svc.duration_minutes);
    } else {
      const fallback = FALLBACK_TYPES.find((f) => f.value === t);
      if (fallback) setDuration(fallback.duration);
    }
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

  const inputClass = "w-full rounded-md border border-black/20 dark:border-white/25 bg-background text-foreground px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

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
            defaultValue={initialDateTime}
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
          <option value="" disabled style={{ background: "var(--background)", color: "var(--muted-foreground)" }}>
            — Select type —
          </option>
          {services.length > 0 ? (
            // Group by category
            (() => {
              const cats = [...new Set(services.map((s) => s.category))];
              return cats.map((cat) => (
                <optgroup key={cat} label={cat.charAt(0).toUpperCase() + cat.slice(1)} style={{ background: "var(--background)", color: "var(--muted-foreground)" }}>
                  {services.filter((s) => s.category === cat).map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name}{fmt(s.price)} · {s.duration_minutes}min
                    </option>
                  ))}
                </optgroup>
              ));
            })()
          ) : (
            FALLBACK_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))
          )}
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

      {bays.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bayId">Bay (optional)</Label>
          <select id="bayId" name="bayId" disabled={pending} className={inputClass}>
            <option value="">— Unassigned —</option>
            {bays.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}{b.description ? ` — ${b.description}` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

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
          render={<Link href="/staff/bookings">Cancel</Link>}
        />
      </div>
    </form>
  );
}
