"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSupplier, updateSupplier, deleteSupplier } from "./actions";

export type Supplier = {
  id: string;
  name: string;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
};

export function SupplierManager({ suppliers, canEdit }: { suppliers: Supplier[]; canEdit: boolean }) {
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      {canEdit && (
        <div>
          <Button onClick={() => setShowAdd((v) => !v)}>
            <Plus className="mr-1.5 h-4 w-4" />
            {showAdd ? "Cancel" : "Add supplier"}
          </Button>
        </div>
      )}

      {showAdd && canEdit && <AddSupplierForm onDone={() => setShowAdd(false)} />}

      {suppliers.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-sm text-muted-foreground">No suppliers yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Phone</th>
                <th className="px-3 py-2 font-medium">Notes</th>
                {canEdit && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <SupplierRow key={s.id} supplier={s} canEdit={canEdit} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SupplierRow({ supplier, canEdit }: { supplier: Supplier; canEdit: boolean }) {
  const [name, setName] = useState(supplier.name);
  const [email, setEmail] = useState(supplier.contact_email ?? "");
  const [phone, setPhone] = useState(supplier.contact_phone ?? "");
  const [notes, setNotes] = useState(supplier.notes ?? "");
  const [pending, startTransition] = useTransition();

  function save(fields: Parameters<typeof updateSupplier>[1]) {
    startTransition(async () => { await updateSupplier(supplier.id, fields); });
  }
  function handleDelete() {
    if (!confirm(`Delete "${supplier.name}"?`)) return;
    startTransition(async () => { await deleteSupplier(supplier.id); });
  }

  const cell = "w-full rounded border bg-background px-2 py-1 text-xs";

  return (
    <tr className="border-t align-top">
      <td className="px-3 py-2">
        {canEdit ? (
          <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== supplier.name && save({ name: name.trim() })} className={cell} />
        ) : supplier.name}
      </td>
      <td className="px-3 py-2">
        {canEdit ? (
          <input value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => email !== (supplier.contact_email ?? "") && save({ contact_email: email || null })} placeholder="—" className={cell} />
        ) : (supplier.contact_email ?? "—")}
      </td>
      <td className="px-3 py-2">
        {canEdit ? (
          <input value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={() => phone !== (supplier.contact_phone ?? "") && save({ contact_phone: phone || null })} placeholder="—" className={cell} />
        ) : (supplier.contact_phone ?? "—")}
      </td>
      <td className="px-3 py-2">
        {canEdit ? (
          <input value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (supplier.notes ?? "") && save({ notes: notes || null })} placeholder="—" className={cell} />
        ) : (supplier.notes ?? "—")}
      </td>
      {canEdit && (
        <td className="px-3 py-2 text-right">
          <button type="button" onClick={handleDelete} disabled={pending} className="text-muted-foreground hover:text-red-600" aria-label="Delete supplier">
            <Trash2 className="h-4 w-4" />
          </button>
        </td>
      )}
    </tr>
  );
}

function AddSupplierForm({ onDone }: { onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createSupplier(formData);
      if ("error" in result) setError(result.error);
      else onDone();
    });
  }

  return (
    <form action={handleSubmit} className="rounded-lg border p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        <Label htmlFor="name">Name *</Label>
        <Input id="name" name="name" required disabled={pending} />
      </div>
      <div>
        <Label htmlFor="contactEmail">Email</Label>
        <Input id="contactEmail" name="contactEmail" type="email" disabled={pending} />
      </div>
      <div>
        <Label htmlFor="contactPhone">Phone</Label>
        <Input id="contactPhone" name="contactPhone" disabled={pending} />
      </div>
      <div>
        <Label htmlFor="notes">Notes</Label>
        <Input id="notes" name="notes" disabled={pending} />
      </div>
      <div className="sm:col-span-2 flex gap-2">
        <Button type="submit" loading={pending}>Add supplier</Button>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
      </div>
      {error && <p className="sm:col-span-2 text-sm text-red-600">{error}</p>}
    </form>
  );
}
