"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateVehicle, dvlaLookup, checkRecalls, vedLookup } from "../../../../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Vehicle = {
  id: string;
  registration: string;
  make: string | null;
  model: string | null;
  year: number | null;
  mot_expiry: string | null;
  service_due: string | null;
};

type RecallInfo = { makeModel: string; recallNumber: string; defectDescription: string; remedyDescription: string; recallDate: string };

export function EditVehicleForm({ vehicle, customerId }: { vehicle: Vehicle; customerId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lookupPending, startLookup] = useTransition();
  const [recallPending, startRecall] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupHint, setLookupHint] = useState<string | null>(null);
  const [recallResult, setRecallResult] = useState<{ hasRecall: boolean; recalls: RecallInfo[] } | null>(null);
  const [recallError, setRecallError] = useState<string | null>(null);
  const [motHint, setMotHint] = useState<string | null>(null);

  const [registration, setRegistration] = useState(vehicle.registration);
  const [make, setMake] = useState(vehicle.make ?? "");
  const [model, setModel] = useState(vehicle.model ?? "");
  const [year, setYear] = useState(vehicle.year ? String(vehicle.year) : "");
  const [motExpiry, setMotExpiry] = useState(vehicle.mot_expiry ?? "");
  const [serviceDue, setServiceDue] = useState(vehicle.service_due ?? "");
  const [taxDueDate, setTaxDueDate] = useState((vehicle as typeof vehicle & { tax_due_date?: string | null }).tax_due_date ?? "");
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
        setLookupHint(`Updated from DVLA: ${filled.join(", ") || "vehicle found"}.`);
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

  function handleRecallCheck() {
    setRecallError(null);
    setRecallResult(null);
    startRecall(async () => {
      const result = await checkRecalls(vehicle.id, registration);
      if ("error" in result) setRecallError(result.error);
      else setRecallResult(result);
    });
  }

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await updateVehicle(vehicle.id, customerId, formData);
      if ("error" in result) setError(result.error);
      else router.push(`/staff/customers/${customerId}`);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vehicle details</CardTitle>
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
                className="font-mono uppercase"
                autoComplete="off"
                value={registration}
                onChange={(e) => { setRegistration(e.target.value.toUpperCase()); setLookupHint(null); setLookupError(null); }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={!registration.trim() || lookupPending}
                onClick={handleLookup}
              >
                {lookupPending ? "Looking up…" : "Refresh DVLA"}
              </Button>
            </div>
            {lookupHint && <p className="text-xs text-green-700">{lookupHint}</p>}
            {lookupError && <p className="text-xs text-red-600">{lookupError}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="make">Make</Label>
              <Input id="make" name="make" value={make} onChange={(e) => setMake(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="model">Model</Label>
              <Input id="model" name="model" value={model} onChange={(e) => setModel(e.target.value)} />
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
          <Button type="submit" disabled={pending} className="self-start">
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </form>

        <div className="mt-4 border-t pt-4 flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={recallPending || !registration.trim()}
              onClick={handleRecallCheck}
            >
              {recallPending ? "Checking…" : "Check DVSA safety recalls"}
            </Button>
            {recallError && <span className="text-xs text-red-600">{recallError}</span>}
          </div>
          {recallResult && (
            recallResult.hasRecall ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 flex flex-col gap-2">
                <p className="text-sm font-semibold text-red-700">⚠️ Outstanding safety recall on this vehicle</p>
                <p className="text-xs text-red-800">DVSA has flagged an outstanding recall for {registration}. The customer&apos;s vehicle should not be returned until the recall is addressed.</p>
                <a
                  href={`https://www.check-mot.service.gov.uk/results?registration=${encodeURIComponent(registration)}&checkRecalls=true`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-red-700 underline"
                >
                  View full recall details for {registration} on GOV.UK →
                </a>
              </div>
            ) : (
              <p className="text-xs text-green-700">✓ No outstanding recalls found for {registration}.</p>
            )
          )}
        </div>
      </CardContent>
    </Card>
  );
}
