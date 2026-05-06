"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addVehicle, dvlaLookup, vedLookup } from "../../../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function VehicleForm({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lookupPending, startLookup] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupHint, setLookupHint] = useState<string | null>(null);
  const [motHint, setMotHint] = useState<string | null>(null);

  const [registration, setRegistration] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [motExpiry, setMotExpiry] = useState("");
  const [serviceDue, setServiceDue] = useState("");
  const [taxDueDate, setTaxDueDate] = useState("");
  const [vedPending, startVed] = useTransition();
  const [vedHint, setVedHint] = useState<string | null>(null);
  const [vedError, setVedError] = useState<string | null>(null);

  function handleLookup() {
    if (!registration.trim()) return;
    setLookupError(null);
    setLookupHint(null);
    setVedError(null);
    setVedHint(null);
    startLookup(async () => {
      const [motResult, vedResult] = await Promise.all([
        dvlaLookup(registration.trim()),
        vedLookup(registration.trim()),
      ]);

      if ("error" in motResult) {
        setLookupError(motResult.error);
      } else {
        const v = motResult.vehicle;
        if (v.make) setMake(v.make);
        if (v.model) setModel(v.model);
        if (v.year) setYear(String(v.year));
        if (v.motExpiry) setMotExpiry(v.motExpiry);
        const filled = [v.make, v.model, v.year].filter(Boolean);
        setLookupHint(`Found: ${filled.join(", ") || "vehicle exists"}.`);
        setMotHint(v.noMotHistory
          ? `No MOT history — vehicle under 3 years old. First MOT due ${v.motExpiry ?? "unknown"} (auto-filled).`
          : null);
      }

      if (!("error" in vedResult)) {
        if (vedResult.taxDueDate) setTaxDueDate(vedResult.taxDueDate);
        if (vedResult.taxDueDate) {
          setVedHint(`Tax due: ${new Date(vedResult.taxDueDate).toLocaleDateString("en-GB")}${vedResult.taxStatus ? ` (${vedResult.taxStatus})` : ""}`);
        }
      }
    });
  }

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await addVehicle(customerId, formData);
      if ("error" in result) {
        setError(result.error);
      } else {
        router.push(`/staff/customers/${customerId}`);
      }
    });
  }

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>New vehicle</CardTitle>
        <CardDescription>
          Enter a registration and click Lookup to auto-fill details from DVLA.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="registration">Registration</Label>
            <div className="flex gap-2">
              <Input
                id="registration"
                name="registration"
                required
                placeholder="AB12 CDE"
                autoComplete="off"
                className="font-mono uppercase"
                value={registration}
                onChange={(e) => {
                  setRegistration(e.target.value.toUpperCase());
                  setLookupHint(null);
                  setLookupError(null);
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={!registration.trim() || lookupPending}
                onClick={handleLookup}
              >
                {lookupPending ? "Looking up…" : "Lookup"}
              </Button>
            </div>
            {lookupHint && <p className="text-xs text-green-700">{lookupHint}</p>}
            {lookupError && <p className="text-xs text-red-600">{lookupError}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="make">Make</Label>
              <Input id="make" name="make" placeholder="Ford" value={make} onChange={(e) => setMake(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="model">Model</Label>
              <Input id="model" name="model" placeholder="Focus" value={model} onChange={(e) => setModel(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="year">Year</Label>
            <Input
              id="year"
              name="year"
              type="number"
              min="1900"
              max={new Date().getFullYear() + 1}
              placeholder="2018"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="motExpiry">MOT expiry</Label>
              <Input id="motExpiry" name="motExpiry" type="date" value={motExpiry} onChange={(e) => setMotExpiry(e.target.value)} />
              {motHint && <p className="text-xs text-amber-600">{motHint}</p>}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="serviceDue">Service due</Label>
              <Input id="serviceDue" name="serviceDue" type="date" value={serviceDue} onChange={(e) => setServiceDue(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="taxDueDate">Road tax due</Label>
            <Input id="taxDueDate" name="taxDueDate" type="date" value={taxDueDate} onChange={(e) => setTaxDueDate(e.target.value)} />
            {vedHint && <p className="text-xs text-green-700">{vedHint}</p>}
          </div>


          {error && <p className="text-sm text-red-600">{error}</p>}

          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save vehicle"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
