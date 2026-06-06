"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, ChevronDown, ChevronRight, PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createPurchaseOrder, markPurchaseOrderOrdered, receivePurchaseOrder, deletePurchaseOrder, type NewPOItem } from "./actions";

export type POProduct = { id: string; name: string; cost_price: number | null; unit_price: number };
export type POSupplier = { id: string; name: string };
export type POItem = { id: string; description: string; quantity: number; unit_cost: number; product_id: string | null };
export type PORow = {
  id: string;
  reference: string | null;
  status: string;
  orderedAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  supplierName: string | null;
  items: POItem[];
};

const fmt = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const STATUS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  ordered: "bg-blue-100 text-blue-700",
  received: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
};

function poTotal(items: POItem[]) {
  return items.reduce((s, it) => s + it.quantity * it.unit_cost, 0);
}

export function PurchaseOrderManager({
  orders,
  suppliers,
  products,
  canEdit,
}: {
  orders: PORow[];
  suppliers: POSupplier[];
  products: POProduct[];
  canEdit: boolean;
}) {
  const [showNew, setShowNew] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      {canEdit && (
        <div>
          <Button onClick={() => setShowNew((v) => !v)}>
            <Plus className="mr-1.5 h-4 w-4" />
            {showNew ? "Cancel" : "New purchase order"}
          </Button>
        </div>
      )}

      {showNew && canEdit && <NewPOForm suppliers={suppliers} products={products} onDone={() => setShowNew(false)} />}

      {orders.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-sm text-muted-foreground">No purchase orders yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {orders.map((po) => (
            <POCard key={po.id} po={po} canEdit={canEdit} />
          ))}
        </div>
      )}
    </div>
  );
}

function POCard({ po, canEdit }: { po: PORow; canEdit: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ error: string } | { success: true }>, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if ("error" in r) setError(r.error);
      else router.refresh();
    });
  }

  return (
    <div className="rounded-lg border">
      <div className="flex items-center justify-between gap-3 p-3">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 text-left">
          {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          <span>
            <span className="font-medium">{po.reference || "PO"}</span>
            <span className="ml-2 text-xs text-muted-foreground">
              {po.supplierName ?? "No supplier"} · {fmtDate(po.createdAt)} · {po.items.length} item{po.items.length === 1 ? "" : "s"}
            </span>
          </span>
        </button>
        <div className="flex items-center gap-3">
          <span className="tabular-nums text-sm font-medium">{fmt(poTotal(po.items))}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS[po.status] ?? ""}`}>{po.status}</span>
        </div>
      </div>

      {open && (
        <div className="border-t p-3">
          <table className="w-full text-sm">
            <tbody>
              {po.items.map((it) => (
                <tr key={it.id} className="border-b last:border-0">
                  <td className="py-1.5">{it.description}{!it.product_id && <span className="ml-1 text-[10px] text-muted-foreground">(no stock link)</span>}</td>
                  <td className="py-1.5 text-right tabular-nums text-muted-foreground">×{it.quantity}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmt(it.quantity * it.unit_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {canEdit && (
            <div className="mt-3 flex flex-wrap gap-2">
              {po.status === "draft" && (
                <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => markPurchaseOrderOrdered(po.id))}>
                  Mark ordered
                </Button>
              )}
              {(po.status === "draft" || po.status === "ordered") && (
                <Button size="sm" disabled={pending} onClick={() => run(() => receivePurchaseOrder(po.id), "Receive this order? Stock for its parts will be added.")}>
                  <PackageCheck className="mr-1.5 h-4 w-4" /> Receive into stock
                </Button>
              )}
              {po.status !== "received" && (
                <Button size="sm" variant="destructive" disabled={pending} onClick={() => run(() => deletePurchaseOrder(po.id), "Delete this purchase order?")}>
                  Delete
                </Button>
              )}
              {po.receivedAt && <span className="self-center text-xs text-muted-foreground">Received {fmtDate(po.receivedAt)}</span>}
            </div>
          )}
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}

type DraftLine = { productId: string; description: string; quantity: string; unitCost: string };
const emptyLine = (): DraftLine => ({ productId: "", description: "", quantity: "1", unitCost: "0" });

function NewPOForm({ suppliers, products, onDone }: { suppliers: POSupplier[]; products: POProduct[]; onDone: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);

  function setLine(idx: number, patch: Partial<DraftLine>) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  function pickProduct(idx: number, productId: string) {
    if (!productId) {
      setLine(idx, { productId: "" });
      return;
    }
    const p = products.find((x) => x.id === productId);
    setLine(idx, {
      productId,
      description: p?.name ?? "",
      unitCost: p?.cost_price != null ? String(p.cost_price) : "0",
    });
  }

  const total = lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.unitCost) || 0), 0);
  const inputClass = "w-full rounded-md border bg-background px-2 py-1.5 text-sm";

  function submit() {
    setError(null);
    const items: NewPOItem[] = lines
      .map((l) => ({
        productId: l.productId || null,
        description: l.description.trim(),
        quantity: parseFloat(l.quantity) || 0,
        unitCost: parseFloat(l.unitCost) || 0,
      }))
      .filter((it) => it.description && it.quantity > 0);
    if (items.length === 0) {
      setError("Add at least one line with a description and quantity.");
      return;
    }
    startTransition(async () => {
      const r = await createPurchaseOrder({ supplierId: supplierId || null, reference: reference.trim() || null, notes: null, items });
      if ("error" in r) setError(r.error);
      else {
        onDone();
        router.refresh();
      }
    });
  }

  return (
    <div className="rounded-lg border p-4 flex flex-col gap-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label htmlFor="po-supplier">Supplier</Label>
          <select id="po-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} disabled={pending} className={inputClass}>
            <option value="">— No supplier —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="po-ref">Reference</Label>
          <Input id="po-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. ECP-10432" disabled={pending} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label className="text-xs">Line items</Label>
        {lines.map((l, idx) => (
          <div key={idx} className="grid grid-cols-[1fr_1fr_70px_90px_auto] items-center gap-2">
            <select value={l.productId} onChange={(e) => pickProduct(idx, e.target.value)} disabled={pending} className={inputClass}>
              <option value="">Custom / no product</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <input value={l.description} onChange={(e) => setLine(idx, { description: e.target.value, productId: l.productId ? "" : l.productId })} placeholder="Description" disabled={pending} className={inputClass} />
            <input type="number" min="0" step="any" value={l.quantity} onChange={(e) => setLine(idx, { quantity: e.target.value })} placeholder="Qty" disabled={pending} className={`${inputClass} text-right`} />
            <input type="number" min="0" step="0.01" value={l.unitCost} onChange={(e) => setLine(idx, { unitCost: e.target.value })} placeholder="Unit £" disabled={pending} className={`${inputClass} text-right`} />
            <button type="button" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, i) => i !== idx) : ls))} disabled={pending} className="text-muted-foreground hover:text-red-600" aria-label="Remove line">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <div>
          <button type="button" onClick={() => setLines((ls) => [...ls, emptyLine()])} disabled={pending} className="text-sm text-primary underline">
            + Add line
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between border-t pt-3">
        <span className="text-sm text-muted-foreground">Total: <span className="font-medium tabular-nums text-foreground">{fmt(total)}</span></span>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onDone} disabled={pending}>Cancel</Button>
          <Button type="button" onClick={submit} loading={pending}>Create order</Button>
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
