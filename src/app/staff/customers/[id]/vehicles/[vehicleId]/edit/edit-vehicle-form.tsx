"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateVehicle } from "../../../../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Vehicle = {
  id: string;
  registration: string;
  make: string | null;
  model: string | null;
  year: number | null;
  mot_expiry: string | null;
  service_due: string | null;
};

export function EditVehicleForm({
  vehicle,
  customerId,
}: {
  vehicle: Vehicle;
  customerId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await updateVehicle(vehicle.id, customerId, formData);
      if ("error" in result) {
        setError(result.error);
      } else {
        router.push(`/staff/customers/${customerId}`);
      }
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
            <Input
              id="registration"
              name="registration"
              required
              defaultValue={vehicle.registration}
              className="font-mono uppercase"
              autoComplete="off"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="make">Make</Label>
              <Input id="make" name="make" defaultValue={vehicle.make ?? ""} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="model">Model</Label>
              <Input id="model" name="model" defaultValue={vehicle.model ?? ""} />
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
              defaultValue={vehicle.year ?? ""}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="motExpiry">MOT expiry</Label>
              <Input
                id="motExpiry"
                name="motExpiry"
                type="date"
                defaultValue={vehicle.mot_expiry ?? ""}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="serviceDue">Service due</Label>
              <Input
                id="serviceDue"
                name="serviceDue"
                type="date"
                defaultValue={vehicle.service_due ?? ""}
              />
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" disabled={pending} className="self-start">
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
