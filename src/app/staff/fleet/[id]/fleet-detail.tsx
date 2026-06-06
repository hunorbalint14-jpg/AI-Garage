"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { updateFleetCompany, deleteFleetCompany, assignCustomerToFleet } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Company = { id: string; name: string; contact_name: string | null; contact_email: string | null; contact_phone: string | null; notes: string | null };
type Customer = { id: string; full_name: string | null; email: string | null; phone: string | null };
type Vehicle = { id: string; customer_id: string; registration: string; make: string | null; model: string | null; year: number | null; mot_expiry: string | null; service_due: string | null };

function dueDays(d: string | null) {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}
function dueBadge(d: string | null) {
  const days = dueDays(d);
  if (days === null) return <span className="text-muted-foreground">—</span>;
  if (days < 0) return <span className="text-red-600 font-semibold text-xs">Overdue</span>;
  if (days <= 30) return <span className="text-red-600 font-semibold text-xs">{days}d</span>;
  if (days <= 60) return <span className="text-amber-600 font-medium text-xs">{days}d</span>;
  return <span className="text-muted-foreground text-xs">{new Date(d!).toLocaleDateString("en-GB")}</span>;
}

export function FleetDetail({ company, customers, vehicles, unassignedCustomers }: {
  company: Company;
  customers: Customer[];
  vehicles: Vehicle[];
  unassignedCustomers: { id: string; full_name: string | null; email: string | null }[];
}) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");

  function handleUpdate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await updateFleetCompany(company.id, fd);
      if ("error" in result) setError(result.error);
      else setEditing(false);
    });
  }

  function handleDelete() {
    if (!confirm(`Delete ${company.name}? Customers will be unlinked.`)) return;
    startTransition(async () => { await deleteFleetCompany(company.id); });
  }

  function handleAddCustomer() {
    if (!selectedCustomerId) return;
    startTransition(async () => {
      await assignCustomerToFleet(selectedCustomerId, company.id);
      setAddingCustomer(false);
      setSelectedCustomerId("");
    });
  }

  function handleRemoveCustomer(customerId: string) {
    if (!confirm("Remove this customer from the fleet?")) return;
    startTransition(async () => { await assignCustomerToFleet(customerId, null); });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{company.name}</h1>
          {company.contact_name && <p className="text-sm text-muted-foreground">{company.contact_name}</p>}
          {company.contact_phone && <p className="text-sm text-muted-foreground">{company.contact_phone}</p>}
          {company.contact_email && <p className="text-sm text-muted-foreground">{company.contact_email}</p>}
        </div>
        <div className="flex gap-2 shrink-0">
          <Button size="sm" variant="outline" onClick={() => setEditing(!editing)}>Edit</Button>
          <Button size="sm" variant="destructive" onClick={handleDelete} disabled={pending}>Delete</Button>
        </div>
      </div>

      {/* Edit form */}
      {editing && (
        <form onSubmit={handleUpdate} className="rounded-lg border p-4 flex flex-col gap-3 max-w-md">
          <div className="flex flex-col gap-1.5"><Label>Company name *</Label><Input name="name" defaultValue={company.name} required disabled={pending} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5"><Label>Contact name</Label><Input name="contactName" defaultValue={company.contact_name ?? ""} disabled={pending} /></div>
            <div className="flex flex-col gap-1.5"><Label>Phone</Label><Input name="contactPhone" defaultValue={company.contact_phone ?? ""} disabled={pending} /></div>
          </div>
          <div className="flex flex-col gap-1.5"><Label>Email</Label><Input name="contactEmail" type="email" defaultValue={company.contact_email ?? ""} disabled={pending} /></div>
          <div className="flex flex-col gap-1.5"><Label>Notes</Label><Input name="notes" defaultValue={company.notes ?? ""} disabled={pending} /></div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={pending}>Save</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </form>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Drivers</p>
          <p className="text-3xl font-bold mt-1">{customers.length}</p>
        </div>
        <div className="rounded-xl border p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Vehicles</p>
          <p className="text-3xl font-bold mt-1">{vehicles.length}</p>
        </div>
      </div>

      {/* Vehicle fleet overview */}
      <section>
        <h2 className="mb-3 text-base font-semibold">Fleet vehicles</h2>
        {vehicles.length === 0 ? (
          <p className="text-sm text-muted-foreground">No vehicles — add customers to the fleet first.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Reg</th>
                  <th className="px-4 py-2 font-medium">Vehicle</th>
                  <th className="px-4 py-2 font-medium">Driver</th>
                  <th className="px-4 py-2 font-medium">MOT expiry</th>
                  <th className="px-4 py-2 font-medium">Service due</th>
                </tr>
              </thead>
              <tbody>
                {vehicles.map((v) => {
                  const driver = customers.find((c) => c.id === v.customer_id);
                  return (
                    <tr key={v.id} className="border-t">
                      <td className="px-4 py-2 font-mono">{v.registration}</td>
                      <td className="px-4 py-2">{[v.year, v.make, v.model].filter(Boolean).join(" ") || "—"}</td>
                      <td className="px-4 py-2">
                        {driver ? (
                          <Link href={`/staff/customers/${driver.id}`} className="underline">
                            {driver.full_name ?? "—"}
                          </Link>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-2">{dueBadge(v.mot_expiry)}</td>
                      <td className="px-4 py-2">{dueBadge(v.service_due)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Customers */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold">Drivers / contacts</h2>
          <button type="button" onClick={() => setAddingCustomer(!addingCustomer)} className="text-sm underline text-muted-foreground">
            {addingCustomer ? "Cancel" : "+ Add customer"}
          </button>
        </div>

        {addingCustomer && (
          <div className="flex gap-2 mb-3">
            <select
              value={selectedCustomerId}
              onChange={(e) => setSelectedCustomerId(e.target.value)}
              className="flex-1 rounded-md border border-black/20 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">— Select customer —</option>
              {unassignedCustomers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name ?? "Unnamed"} {c.email ? `(${c.email})` : ""}
                </option>
              ))}
            </select>
            <Button size="sm" onClick={handleAddCustomer} disabled={!selectedCustomerId} loading={pending}>
              Add
            </Button>
          </div>
        )}

        {customers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No customers assigned. Add existing customers above.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Email</th>
                  <th className="px-4 py-2 font-medium">Phone</th>
                  <th className="px-4 py-2 font-medium">Vehicles</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.id} className="border-t">
                    <td className="px-4 py-2">
                      <Link href={`/staff/customers/${c.id}`} className="underline">{c.full_name ?? "—"}</Link>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{c.email ?? "—"}</td>
                    <td className="px-4 py-2 text-muted-foreground">{c.phone ?? "—"}</td>
                    <td className="px-4 py-2">{vehicles.filter((v) => v.customer_id === c.id).length}</td>
                    <td className="px-4 py-2 text-right">
                      <button type="button" onClick={() => handleRemoveCustomer(c.id)} disabled={pending}
                        className="text-xs text-muted-foreground hover:text-red-600 transition-colors">
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
