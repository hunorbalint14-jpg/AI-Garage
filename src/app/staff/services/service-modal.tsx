"use client";

import { useState, useTransition } from "react";
import { upsertService, toggleServiceActive, deleteService } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

export type ServiceRow = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  price: number | null;
  duration_minutes: number;
  vat_included: boolean;
  active: boolean;
};

const CATEGORIES = [
  "MOT", "Servicing", "Brakes", "Tyres", "Exhausts",
  "Clutch & Gearbox", "Electrics", "Air Conditioning",
  "Diagnostics", "Bodywork", "General",
];

function fmt(n: number | null) {
  if (n === null) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

function ServiceForm({ service, onDone }: { service?: ServiceRow; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await upsertService(formData, service?.id);
      if ("error" in result) setError(result.error);
      else onDone();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5 col-span-2">
          <Label>Service name *</Label>
          <Input name="name" required defaultValue={service?.name ?? ""} placeholder="e.g. Full Service, MOT Test" disabled={pending} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Category</Label>
          <NativeSelect name="category" defaultValue={service?.category ?? "General"} disabled={pending}>
            {CATEGORIES.map((c) => <option key={c} value={c.toLowerCase()}>{c}</option>)}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Duration (min)</Label>
          <Input name="durationMinutes" type="number" min="5" step="5" defaultValue={service?.duration_minutes ?? 60} disabled={pending} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Price (£)</Label>
          <Input name="price" type="number" min="0" step="0.01" placeholder="0.00" defaultValue={service?.price ?? ""} disabled={pending} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>VAT</Label>
          <NativeSelect name="vatIncluded" defaultValue={service?.vat_included !== false ? "true" : "false"} disabled={pending}>
            <option value="true">Price includes VAT</option>
            <option value="false">Price ex-VAT</option>
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5 col-span-2">
          <Label>Description</Label>
          <Input name="description" placeholder="Optional description for customers" defaultValue={service?.description ?? ""} disabled={pending} />
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" loading={pending}>{service ? "Save changes" : "Add service"}</Button>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>Cancel</Button>
      </div>
    </form>
  );
}

export function ServiceCard({ service }: { service: ServiceRow }) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleToggle() {
    startTransition(async () => { await toggleServiceActive(service.id, !service.active); });
  }

  function handleDelete() {
    if (!confirm(`Delete "${service.name}"?`)) return;
    startTransition(async () => { await deleteService(service.id); });
  }

  if (editing) {
    return (
      <div className="rounded-xl border p-4">
        <ServiceForm service={service} onDone={() => setEditing(false)} />
      </div>
    );
  }

  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-2 ${!service.active ? "opacity-50" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold">{service.name}</p>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize">{service.category}</span>
            {!service.active && <span className="rounded-full bg-gray-100 text-gray-500 px-2 py-0.5 text-xs">Inactive</span>}
          </div>
          {service.description && <p className="text-xs text-muted-foreground mt-0.5">{service.description}</p>}
        </div>
        <div className="shrink-0 text-right">
          <p className="font-bold text-lg tabular-nums">{fmt(service.price)}</p>
          <p className="text-xs text-muted-foreground">{service.duration_minutes} min · VAT {service.vat_included ? "incl." : "excl."}</p>
        </div>
      </div>
      <div className="flex gap-2 pt-1 border-t">
        <button type="button" onClick={() => setEditing(true)} disabled={pending} className="text-xs underline text-muted-foreground hover:text-foreground">Edit</button>
        <button type="button" onClick={handleToggle} disabled={pending} className="text-xs underline text-muted-foreground hover:text-foreground">
          {service.active ? "Deactivate" : "Activate"}
        </button>
        <button type="button" onClick={handleDelete} disabled={pending} className="text-xs underline text-red-500 hover:text-red-700">Delete</button>
      </div>
    </div>
  );
}

export function AddServiceButton() {
  const [open, setOpen] = useState(false);

  if (!open) return <Button onClick={() => setOpen(true)}>+ Add service</Button>;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl bg-background border shadow-xl p-6">
        <h2 className="text-lg font-bold mb-4">New service</h2>
        <ServiceForm onDone={() => setOpen(false)} />
      </div>
    </div>
  );
}
