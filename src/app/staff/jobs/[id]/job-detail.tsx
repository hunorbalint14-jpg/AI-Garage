"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addJobItem, removeJobItem, completeJob, reopenJob, deleteJob, updateJob, sendReviewRequest } from "../actions";
import { createInvoiceFromJob } from "../../invoices/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Job = {
  id: string;
  status: string;
  description: string | null;
  notes: string | null;
  created_at: string;
  completed_at: string | null;
  booking_id: string | null;
  customer: { id: string; full_name: string | null; email: string | null; phone: string | null } | null;
  vehicle: { id: string; registration: string; make: string | null; model: string | null; year: number | null } | null;
};

type JobItem = {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  type: string;
};

const STATUS_STYLE: Record<string, string> = {
  open: "bg-blue-100 text-blue-700",
  complete: "bg-green-100 text-green-700",
  invoiced: "bg-purple-100 text-purple-700",
};

function formatGBP(n: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

export function JobDetail({ job, items }: { job: Job; items: JobItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reviewSuccess, setReviewSuccess] = useState<string | null>(null);

  const isOpen = job.status === "open";
  const isInvoiced = job.status === "invoiced";

  const labourTotal = items.filter((i) => i.type === "labour").reduce((sum, i) => sum + i.quantity * i.unit_price, 0);
  const partsTotal = items.filter((i) => i.type === "part").reduce((sum, i) => sum + i.quantity * i.unit_price, 0);
  const otherTotal = items.filter((i) => i.type === "other").reduce((sum, i) => sum + i.quantity * i.unit_price, 0);
  const subtotal = labourTotal + partsTotal + otherTotal;

  function handleAddItem(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const formData = new FormData(form);
    startTransition(async () => {
      const result = await addJobItem(job.id, formData);
      if ("error" in result) {
        setError(result.error);
      } else {
        form.reset();
      }
    });
  }

  function handleRemoveItem(itemId: string) {
    setError(null);
    startTransition(async () => {
      const result = await removeJobItem(job.id, itemId);
      if ("error" in result) setError(result.error);
    });
  }

  function handleUpdate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await updateJob(job.id, formData);
      if ("error" in result) setError(result.error);
    });
  }

  function handleComplete() {
    if (!confirm("Mark this job complete? You won't be able to add items after.")) return;
    setError(null);
    startTransition(async () => {
      const result = await completeJob(job.id);
      if ("error" in result) setError(result.error);
    });
  }

  function handleReopen() {
    setError(null);
    startTransition(async () => {
      const result = await reopenJob(job.id);
      if ("error" in result) setError(result.error);
    });
  }

  function handleDelete() {
    if (!confirm("Delete this job permanently?")) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteJob(job.id);
      if ("error" in result) setError(result.error);
    });
  }

  function handleCreateInvoice() {
    setError(null);
    startTransition(async () => {
      const result = await createInvoiceFromJob(job.id);
      if ("error" in result) setError(result.error);
      else router.push(`/staff/invoices/${result.invoiceId}`);
    });
  }

  function handleReviewRequest() {
    setReviewSuccess(null);
    setError(null);
    startTransition(async () => {
      const result = await sendReviewRequest(job.id);
      if ("error" in result) setError(result.error);
      else setReviewSuccess(`Review request sent via ${result.channels.join(" + ")}.`);
    });
  }

  const inputClass = "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Job card</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Created {new Date(job.created_at).toLocaleDateString("en-GB")}
            {job.completed_at && ` · Completed ${new Date(job.completed_at).toLocaleDateString("en-GB")}`}
          </p>
        </div>
        <span className={`shrink-0 mt-1 inline-block rounded-full px-3 py-1 text-xs font-medium capitalize ${STATUS_STYLE[job.status] ?? ""}`}>
          {job.status}
        </span>
      </div>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">Customer & Vehicle</h2>
        <dl className="grid grid-cols-[140px_1fr] gap-y-1 text-sm">
          <dt className="text-muted-foreground">Customer</dt>
          <dd>
            {job.customer ? (
              <Link href={`/staff/customers/${job.customer.id}`} className="underline">
                {job.customer.full_name ?? "Unknown"}
              </Link>
            ) : "—"}
          </dd>
          <dt className="text-muted-foreground">Vehicle</dt>
          <dd>
            {job.vehicle ? (
              <span>
                <span className="font-mono">{job.vehicle.registration}</span>
                {(job.vehicle.make || job.vehicle.model) && (
                  <span className="text-muted-foreground"> — {[job.vehicle.year, job.vehicle.make, job.vehicle.model].filter(Boolean).join(" ")}</span>
                )}
              </span>
            ) : "—"}
          </dd>
        </dl>
      </section>

      <form onSubmit={handleUpdate} className="rounded-lg border p-4 flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Description & notes</h2>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="description">Job description</Label>
          <Input
            id="description"
            name="description"
            defaultValue={job.description ?? ""}
            placeholder="e.g. Annual service + brake pads"
            disabled={pending || !isOpen}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="notes">Notes</Label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            defaultValue={job.notes ?? ""}
            placeholder="Internal notes about the work"
            disabled={pending || !isOpen}
            className={inputClass + " resize-none"}
          />
        </div>
        {isOpen && (
          <div>
            <Button type="submit" size="sm" variant="outline" disabled={pending}>
              Save changes
            </Button>
          </div>
        )}
      </form>

      <section className="rounded-lg border">
        <div className="p-4 border-b">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Items</h2>
        </div>

        {items.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No items yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Description</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium text-right">Qty</th>
                <th className="px-4 py-2 font-medium text-right">Unit £</th>
                <th className="px-4 py-2 font-medium text-right">Total</th>
                {isOpen && <th className="px-4 py-2" />}
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-t">
                  <td className="px-4 py-2">{it.description}</td>
                  <td className="px-4 py-2 capitalize text-muted-foreground">{it.type}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{it.quantity}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatGBP(it.unit_price)}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-medium">{formatGBP(it.quantity * it.unit_price)}</td>
                  {isOpen && (
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(it.id)}
                        disabled={pending}
                        className="text-xs text-red-600 underline"
                      >
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-muted/30 text-sm">
              {labourTotal > 0 && (
                <tr className="border-t">
                  <td colSpan={4} className="px-4 py-1.5 text-right text-muted-foreground">Labour</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{formatGBP(labourTotal)}</td>
                  {isOpen && <td />}
                </tr>
              )}
              {partsTotal > 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-1.5 text-right text-muted-foreground">Parts</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{formatGBP(partsTotal)}</td>
                  {isOpen && <td />}
                </tr>
              )}
              {otherTotal > 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-1.5 text-right text-muted-foreground">Other</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{formatGBP(otherTotal)}</td>
                  {isOpen && <td />}
                </tr>
              )}
              <tr className="border-t-2">
                <td colSpan={4} className="px-4 py-2 text-right font-semibold">Subtotal (ex. VAT)</td>
                <td className="px-4 py-2 text-right tabular-nums font-semibold">{formatGBP(subtotal)}</td>
                {isOpen && <td />}
              </tr>
            </tfoot>
          </table>
        )}

        {isOpen && (
          <form onSubmit={handleAddItem} className="p-4 border-t flex flex-col gap-3 bg-muted/10">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Add item</h3>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px_100px_120px_auto] gap-2 items-end">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="description-new" className="text-xs">Description</Label>
                <Input id="description-new" name="description" placeholder="e.g. Front brake pads" required disabled={pending} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="type" className="text-xs">Type</Label>
                <select id="type" name="type" defaultValue="part" disabled={pending} className={inputClass}>
                  <option value="part">Part</option>
                  <option value="labour">Labour</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="quantity" className="text-xs">Qty</Label>
                <Input id="quantity" name="quantity" type="number" step="0.5" min="0.1" defaultValue="1" required disabled={pending} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="unitPrice" className="text-xs">Unit price (£)</Label>
                <Input id="unitPrice" name="unitPrice" type="number" step="0.01" min="0" defaultValue="0" required disabled={pending} />
              </div>
              <Button type="submit" disabled={pending}>{pending ? "Adding…" : "Add"}</Button>
            </div>
          </form>
        )}
      </section>

      <div className="rounded-lg border p-4 flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Actions</h2>
        <div className="flex flex-wrap gap-2">
          {isOpen && (
            <Button onClick={handleComplete} disabled={pending}>
              Mark complete
            </Button>
          )}
          {!isOpen && !isInvoiced && (
            <>
              <Button onClick={handleCreateInvoice} disabled={pending}>
                Create invoice
              </Button>
              <Button variant="outline" onClick={handleReviewRequest} disabled={pending}>
                Request Google review
              </Button>
              <Button variant="outline" onClick={handleReopen} disabled={pending}>
                Reopen job
              </Button>
            </>
          )}
          {isInvoiced && (
            <Button variant="outline" onClick={handleReviewRequest} disabled={pending}>
              Request Google review
            </Button>
          )}
          {!isInvoiced && (
            <Button variant="destructive" onClick={handleDelete} disabled={pending}>
              Delete job
            </Button>
          )}
        </div>
        {reviewSuccess && <p className="text-sm text-green-700">{reviewSuccess}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
