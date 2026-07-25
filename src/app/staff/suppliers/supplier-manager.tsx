"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { WorkshopBadge, MicroLabel, type WorkshopTone } from "@/components/staff/workshop";
import { createSupplier, updateSupplier, deleteSupplier } from "./actions";
import { saveSupplierIntegration, deleteSupplierIntegration } from "./integration-actions";
import {
  CONNECTOR_CREDENTIAL_FIELDS,
  CONNECTOR_KINDS,
  CONNECTOR_LABELS,
  type SupplierConnectorKind,
} from "@/lib/suppliers/types";
import { useConfirm } from "@/components/confirm-provider";

// What the browser is allowed to know about a supplier's ordering config —
// credential VALUES stay server-side, only `hasCredentials` crosses.
export type SupplierOrdering = {
  kind: SupplierConnectorKind;
  enabled: boolean;
  punchoutUrlTemplate: string | null;
  orderEmail: string | null;
  accountNumber: string | null;
  hasCredentials: boolean;
};

export type Supplier = {
  id: string;
  name: string;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  ordering: SupplierOrdering | null;
};

// How a purchase order for this supplier would actually go out.
function orderingBadge(supplier: Supplier): { tone: WorkshopTone; label: string } {
  const o = supplier.ordering;
  if (!o) return { tone: "neutral", label: "Not set up" };
  if (!o.enabled) return { tone: "neutral", label: "Off" };
  const email = o.orderEmail ?? supplier.contact_email;
  if (email && o.punchoutUrlTemplate) return { tone: "green", label: "Email + link" };
  if (email) return { tone: "green", label: "Order email" };
  if (o.punchoutUrlTemplate) return { tone: "blue", label: "Punch-out" };
  return { tone: "amber", label: "Incomplete" };
}

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
                <th className="px-3 py-2 font-medium">Ordering</th>
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
  const confirm = useConfirm();
  const [name, setName] = useState(supplier.name);
  const [email, setEmail] = useState(supplier.contact_email ?? "");
  const [phone, setPhone] = useState(supplier.contact_phone ?? "");
  const [notes, setNotes] = useState(supplier.notes ?? "");
  const [showOrdering, setShowOrdering] = useState(false);
  const [pending, startTransition] = useTransition();

  function save(fields: Parameters<typeof updateSupplier>[1]) {
    startTransition(async () => { await updateSupplier(supplier.id, fields); });
  }
  async function handleDelete() {
    const ok = await confirm({
      title: `Delete supplier "${supplier.name}"?`,
      description: "The supplier is removed from the list. Purchase orders that reference it are kept.",
      confirmLabel: "Delete supplier",
      destructive: true,
    });
    if (!ok) return;
    startTransition(async () => { await deleteSupplier(supplier.id); });
  }

  const cell = "w-full rounded border bg-background px-2 py-1 text-xs";
  const badge = orderingBadge(supplier);

  return (
    <>
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
      <td className="px-3 py-2">
        <button
          type="button"
          onClick={() => setShowOrdering((v) => !v)}
          className="inline-flex items-center gap-1.5 text-left"
          aria-expanded={showOrdering}
        >
          <WorkshopBadge tone={badge.tone}>{badge.label}</WorkshopBadge>
          <Truck className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        </button>
      </td>
      {canEdit && (
        <td className="px-3 py-2 text-right">
          <button type="button" onClick={handleDelete} disabled={pending} className="text-muted-foreground hover:text-ws-red" aria-label="Delete supplier">
            <Trash2 className="h-4 w-4" />
          </button>
        </td>
      )}
    </tr>
    {showOrdering && (
      <tr className="border-t bg-ws-hover/40">
        <td colSpan={canEdit ? 6 : 5} className="px-3 py-4">
          <OrderingForm supplier={supplier} canEdit={canEdit} onDone={() => setShowOrdering(false)} />
        </td>
      </tr>
    )}
    </>
  );
}

// Per-supplier ordering config: how a purchase order reaches this factor.
// Credentials are write-only — the form only ever learns that some are stored.
function OrderingForm({ supplier, canEdit, onDone }: { supplier: Supplier; canEdit: boolean; onDone: () => void }) {
  const confirm = useConfirm();
  const o = supplier.ordering;
  const [kind, setKind] = useState<SupplierConnectorKind>(o?.kind ?? "manual");
  const [enabled, setEnabled] = useState(o?.enabled ?? true);
  const [orderEmail, setOrderEmail] = useState(o?.orderEmail ?? "");
  const [punchout, setPunchout] = useState(o?.punchoutUrlTemplate ?? "");
  const [accountNumber, setAccountNumber] = useState(o?.accountNumber ?? "");
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const credentialFields = CONNECTOR_CREDENTIAL_FIELDS[kind];
  const typed = Object.values(credentials).some((v) => v.trim() !== "");

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveSupplierIntegration(supplier.id, {
        kind,
        enabled,
        orderEmail: orderEmail || null,
        punchoutUrlTemplate: punchout || null,
        accountNumber: accountNumber || null,
        // Omit unless the user typed something, so saving the rest of the form
        // never wipes stored credentials.
        ...(typed ? { credentials } : {}),
      });
      if ("error" in result) setError(result.error);
      else onDone();
    });
  }

  async function remove() {
    const ok = await confirm({
      title: `Remove ordering setup for "${supplier.name}"?`,
      description: "Purchase orders for this supplier go back to being handled by hand.",
      confirmLabel: "Remove setup",
      destructive: true,
    });
    if (!ok) return;
    startTransition(async () => {
      await deleteSupplierIntegration(supplier.id);
      onDone();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <MicroLabel>Ordering</MicroLabel>
      <p className="text-xs text-muted-foreground">
        How purchase orders reach {supplier.name}. An order email sends the order straight from the purchase-order
        screen; a catalogue link opens their own basket for you to finish by hand.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`kind-${supplier.id}`}>Method</Label>
          <NativeSelect
            id={`kind-${supplier.id}`}
            value={kind}
            disabled={!canEdit || pending}
            onChange={(e) => setKind(e.target.value as SupplierConnectorKind)}
          >
            {CONNECTOR_KINDS.map((k) => (
              <option key={k} value={k}>
                {CONNECTOR_LABELS[k]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <Label htmlFor={`order-email-${supplier.id}`}>Order email</Label>
          <Input
            id={`order-email-${supplier.id}`}
            type="email"
            value={orderEmail}
            disabled={!canEdit || pending}
            placeholder={supplier.contact_email ?? "parts@factor.example"}
            onChange={(e) => setOrderEmail(e.target.value)}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            {supplier.contact_email && !orderEmail
              ? `Blank uses the supplier's contact email (${supplier.contact_email}).`
              : "Where the parts desk receives the order."}
          </p>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor={`punchout-${supplier.id}`}>Catalogue link</Label>
          <Input
            id={`punchout-${supplier.id}`}
            value={punchout}
            disabled={!canEdit || pending}
            placeholder="https://factor.example/search?vrm={reg}&q={query}"
            onChange={(e) => setPunchout(e.target.value)}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Optional. <code>{"{reg}"}</code> and <code>{"{query}"}</code>{" "}
            are filled in with the vehicle and the part you&apos;re looking for.
          </p>
        </div>
        <div>
          <Label htmlFor={`account-${supplier.id}`}>Trade account number</Label>
          <Input
            id={`account-${supplier.id}`}
            value={accountNumber}
            disabled={!canEdit || pending}
            placeholder="Optional — printed on the order"
            onChange={(e) => setAccountNumber(e.target.value)}
          />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              disabled={!canEdit || pending}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Ordering enabled
          </label>
        </div>

        {credentialFields.map((f) => (
          <div key={f.name}>
            <Label htmlFor={`cred-${supplier.id}-${f.name}`}>{f.label}</Label>
            <Input
              id={`cred-${supplier.id}-${f.name}`}
              type="password"
              autoComplete="off"
              disabled={!canEdit || pending}
              placeholder={o?.hasCredentials ? "•••••••• (stored)" : ""}
              onChange={(e) => setCredentials((c) => ({ ...c, [f.name]: e.target.value }))}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Stored encrypted and never shown again. Leave blank to keep the current value.
            </p>
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-ws-red">{error}</p>}

      {canEdit && (
        <div className="flex gap-2">
          <Button onClick={save} loading={pending}>
            Save ordering
          </Button>
          {o && (
            <Button type="button" variant="outline" onClick={remove} disabled={pending}>
              Remove setup
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
            Close
          </Button>
        </div>
      )}
    </div>
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
      {error && <p className="sm:col-span-2 text-sm text-ws-red">{error}</p>}
    </form>
  );
}
