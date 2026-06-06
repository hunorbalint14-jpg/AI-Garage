"use client";

import { useTransition, useState } from "react";
import { AigSpinner } from "@/components/ui/aig-spinner";
import { useRouter } from "next/navigation";
import { deleteCustomer, deleteVehicle } from "../actions";
import { Button } from "@/components/ui/button";

export function DeleteCustomerButton({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    if (!confirming) { setConfirming(true); return; }
    startTransition(async () => {
      const result = await deleteCustomer(customerId);
      if ("error" in result) {
        setError(result.error);
        setConfirming(false);
      } else {
        router.push("/staff/customers");
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="destructive"
        size="sm"
        loading={pending}
        onClick={handleClick}
      >
        {confirming ? "Confirm delete" : "Delete customer"}
      </Button>
      {confirming && !pending && (
        <button
          className="text-sm text-muted-foreground underline"
          onClick={() => setConfirming(false)}
        >
          Cancel
        </button>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

export function DeleteVehicleButton({
  vehicleId,
  customerId,
}: {
  vehicleId: string;
  customerId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function handleClick() {
    if (!confirming) { setConfirming(true); return; }
    startTransition(async () => {
      await deleteVehicle(vehicleId, customerId);
      router.refresh();
      setConfirming(false);
    });
  }

  return (
    <div className="flex items-center gap-1">
      <button
        className={`inline-flex items-center gap-1 text-xs underline ${confirming ? "text-red-600 font-medium" : "text-muted-foreground"}`}
        disabled={pending}
        onClick={handleClick}
      >
        {pending && <AigSpinner />}
        {confirming ? "Confirm?" : "Delete"}
      </button>
      {confirming && (
        <button
          className="text-xs text-muted-foreground underline"
          onClick={() => setConfirming(false)}
        >
          Cancel
        </button>
      )}
    </div>
  );
}
