"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createFleetCompany } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function NewFleetForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createFleetCompany(formData);
      if ("error" in result) setError(result.error);
      else { setOpen(false); router.push(`/staff/fleet/${result.id}`); }
    });
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        + New fleet company
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-background border shadow-xl p-6 flex flex-col gap-4">
        <h2 className="text-lg font-bold">New fleet company</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Company name *</Label>
            <Input id="name" name="name" required placeholder="Smith's Taxis Ltd" disabled={pending} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="contactName">Contact name</Label>
              <Input id="contactName" name="contactName" placeholder="John Smith" disabled={pending} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="contactPhone">Phone</Label>
              <Input id="contactPhone" name="contactPhone" type="tel" placeholder="07700 900000" disabled={pending} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contactEmail">Email</Label>
            <Input id="contactEmail" name="contactEmail" type="email" placeholder="fleet@company.com" disabled={pending} />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create"}</Button>
            <Button type="button" variant="outline" onClick={() => { setOpen(false); setError(null); }}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
