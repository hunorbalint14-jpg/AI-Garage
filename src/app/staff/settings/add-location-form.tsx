"use client";

import { useState, useTransition } from "react";
import { addLocation } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirm } from "@/components/confirm-provider";

export function AddLocationForm() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const confirm = useConfirm();

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      let result = await addLocation(formData);
      // Growth beyond the included sites (#461): show the price, then
      // re-submit with the confirmation flag.
      if ("overageConfirmRequired" in result) {
        const price = `£${Math.round(result.pricePence / 100)}`;
        const ok = await confirm({
          title: `Add this site for ${price}/month?`,
          description: `Your Growth plan includes ${result.included} locations. Each site beyond that adds ${price}/month to your subscription, prorated from today. Removing it later removes the charge.`,
          confirmLabel: `Add site · ${price}/mo`,
        });
        if (!ok) return;
        formData.set("confirm_overage", "true");
        result = await addLocation(formData);
      }
      if ("error" in result) {
        setError(result.error);
      } else if ("success" in result) {
        setDone(result.name);
        setOpen(false);
      }
    });
  }

  if (done) {
    return (
      <div className="rounded-md border border-ws-green-border bg-ws-green-bg p-3 text-sm text-ws-green">
        <strong>{done}</strong> created. Switch to it with the branch picker in the top bar.{" "}
        <button className="underline" onClick={() => setDone(null)}>
          Add another
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        + Add location
      </Button>
    );
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-3 rounded-lg border p-4">
      <p className="text-sm font-medium">New location</p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="locName">Location name</Label>
        <Input id="locName" name="name" placeholder="Bristol Branch" required autoFocus />
        <p className="text-xs text-muted-foreground">
          Add the branch&apos;s postal address afterwards in the list above.
        </p>
      </div>
      {error && <p className="text-sm text-ws-red">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={pending}>
          Create location
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => { setOpen(false); setError(null); }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
