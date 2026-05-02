"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addVehicle } from "../../../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function VehicleForm({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
          Registration is required. Other fields are optional and can be filled
          in later. (DVLA auto-lookup coming soon.)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="registration">Registration</Label>
            <Input
              id="registration"
              name="registration"
              required
              placeholder="AB12 CDE"
              autoComplete="off"
              className="font-mono uppercase"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="make">Make</Label>
              <Input id="make" name="make" placeholder="Ford" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="model">Model</Label>
              <Input id="model" name="model" placeholder="Focus" />
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
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="motExpiry">MOT expiry</Label>
              <Input id="motExpiry" name="motExpiry" type="date" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="serviceDue">Service due</Label>
              <Input id="serviceDue" name="serviceDue" type="date" />
            </div>
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
