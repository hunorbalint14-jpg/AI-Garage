"use client";

import { useState, useTransition } from "react";
import { createBay, deleteBay } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Bay = { id: string; name: string; description: string | null; sort_order: number };

export function BayManager({ bays }: { bays: Bay[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    const form = e.currentTarget;
    startTransition(async () => {
      const result = await createBay(formData);
      if ("error" in result) setError(result.error);
      else form.reset();
    });
  }

  function handleDelete(bayId: string, name: string) {
    if (!confirm(`Delete "${name}"? Bookings assigned to it become unassigned.`)) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteBay(bayId);
      if ("error" in result) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {bays.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No bays yet. Add your first one below to enable the bay schedule on the dashboard.
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          {bays.map((bay, i) => (
            <div
              key={bay.id}
              className={`flex items-center justify-between px-4 py-3 gap-4 ${i > 0 ? "border-t" : ""}`}
            >
              <div>
                <p className="text-sm font-medium">{bay.name}</p>
                {bay.description && (
                  <p className="text-xs text-muted-foreground">{bay.description}</p>
                )}
              </div>
              <Button
                variant="destructive"
                size="xs"
                onClick={() => handleDelete(bay.id, bay.name)}
                disabled={pending}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleCreate} className="rounded-lg border p-4 flex flex-col gap-3">
        <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Add bay
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bay-name">Name</Label>
            <Input
              id="bay-name"
              name="name"
              placeholder="Bay 1 · Lift"
              required
              disabled={pending}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bay-desc">Description (optional)</Label>
            <Input
              id="bay-desc"
              name="description"
              placeholder="e.g. 4-post lift, MOT bay"
              disabled={pending}
            />
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div>
          <Button type="submit" size="sm" loading={pending}>
            Add bay
          </Button>
        </div>
      </form>
    </div>
  );
}
