"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  searchCustomersForPicker,
  type PickerCustomer,
} from "@/app/staff/customer-picker-actions";

// Typeahead replacement for the old "ship every customer + vehicle to the
// client and filter in a <select>" pattern. Searches server-side per debounced
// keystroke; the selected customer's vehicles arrive with the search result,
// so the vehicle dropdown needs no extra round-trip.
//
// Posts `customerId` / `vehicleId` via hidden inputs, so parents using
// FormData keep working unchanged; state-driven parents use the callbacks.

const inputClass =
  "w-full rounded-md border border-black/20 dark:border-white/25 bg-background text-foreground px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

export function CustomerVehiclePicker({
  initialCustomer = null,
  initialVehicleId = null,
  disabled = false,
  customerLabel = "Customer",
  vehicleLabel = "Vehicle",
  hideVehicleUntilCustomer = false,
  onCustomerChange,
  onVehicleChange,
}: {
  initialCustomer?: PickerCustomer | null;
  initialVehicleId?: string | null;
  disabled?: boolean;
  customerLabel?: string;
  vehicleLabel?: string;
  hideVehicleUntilCustomer?: boolean;
  onCustomerChange?: (customer: PickerCustomer | null) => void;
  onVehicleChange?: (vehicleId: string) => void;
}) {
  const [selected, setSelected] = useState<PickerCustomer | null>(initialCustomer);
  const [vehicleId, setVehicleId] = useState(initialVehicleId ?? "");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickerCustomer[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function runSearch(q: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const seq = ++seqRef.current;
      setSearching(true);
      try {
        const found = await searchCustomersForPicker(q);
        // Drop stale responses that resolve after a newer keystroke's.
        if (seq === seqRef.current) setResults(found);
      } catch {
        if (seq === seqRef.current) setResults([]);
      } finally {
        if (seq === seqRef.current) setSearching(false);
      }
    }, 250);
  }

  function handleQueryChange(q: string) {
    setQuery(q);
    setOpen(true);
    runSearch(q);
  }

  function pickCustomer(customer: PickerCustomer) {
    setSelected(customer);
    setVehicleId("");
    setQuery("");
    setOpen(false);
    onCustomerChange?.(customer);
    onVehicleChange?.("");
  }

  function clearCustomer() {
    setSelected(null);
    setVehicleId("");
    onCustomerChange?.(null);
    onVehicleChange?.("");
  }

  function pickVehicle(id: string) {
    setVehicleId(id);
    onVehicleChange?.(id);
  }

  const showVehicle = !hideVehicleUntilCustomer || !!selected;

  return (
    <>
      <div className="flex flex-col gap-1.5" ref={rootRef}>
        <Label htmlFor="customer-picker">{customerLabel}</Label>
        <input type="hidden" name="customerId" value={selected?.id ?? ""} />

        {selected ? (
          <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium">{selected.full_name ?? "Unnamed"}</p>
              <p className="truncate text-xs text-muted-foreground">
                {selected.email ?? "no email"} · {selected.phone ?? "no phone"}
              </p>
            </div>
            <button
              type="button"
              onClick={clearCustomer}
              disabled={disabled}
              className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground underline hover:text-foreground disabled:opacity-50"
            >
              <X className="h-3 w-3" /> Change
            </button>
          </div>
        ) : (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id="customer-picker"
              type="text"
              role="combobox"
              aria-expanded={open}
              aria-controls="customer-picker-results"
              autoComplete="off"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              onFocus={() => {
                setOpen(true);
                runSearch(query);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
              }}
              placeholder="Search by name, reg, phone or email…"
              disabled={disabled}
              className={inputClass + " pl-9"}
            />
            {open && (
              <ul
                id="customer-picker-results"
                role="listbox"
                className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-background py-1 shadow-md"
              >
                {searching && results.length === 0 && (
                  <li className="px-3 py-2 text-xs text-muted-foreground">Searching…</li>
                )}
                {!searching && results.length === 0 && (
                  <li className="px-3 py-2 text-xs text-muted-foreground">
                    {query.trim() ? `No customers match "${query.trim()}".` : "No customers yet."}
                  </li>
                )}
                {results.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => pickCustomer(c)}
                      className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-muted"
                    >
                      <span className="font-medium">{c.full_name ?? "Unnamed"}</span>
                      <span className="text-xs text-muted-foreground">
                        {[
                          c.phone,
                          c.vehicles.map((v) => v.registration).join(", ") || null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || c.email || "no contact details"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {showVehicle && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="vehicle-picker">{vehicleLabel}</Label>
          <select
            id="vehicle-picker"
            name="vehicleId"
            value={vehicleId}
            onChange={(e) => pickVehicle(e.target.value)}
            disabled={disabled || !selected}
            className={inputClass}
          >
            <option value="">— No vehicle —</option>
            {(selected?.vehicles ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.registration}
                {v.make || v.model
                  ? ` — ${[v.year, v.make, v.model].filter(Boolean).join(" ")}`
                  : ""}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}
