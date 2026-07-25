"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, ChevronDown, ChevronRight, PackageCheck, Send, ClipboardPaste, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createPurchaseOrder,
  markPurchaseOrderOrdered,
  receivePurchaseOrder,
  deletePurchaseOrder,
  sendPurchaseOrderToSupplier,
  importSupplierConfirmation,
  type NewPOItem,
} from "./actions";
import { useConfirm, type ConfirmOptions } from "@/components/confirm-provider";

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
  supplierId: string | null;
  supplierName: string | null;
  sentAt: string | null;
  sentChannel: string | null;
  supplierOrderRef: string | null;
  confirmationImportedAt: string | null;
  items: POItem[];
};

const fmt = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const STATUS: Record<string, string> = {
  draft: "bg-ws-hover text-ws-text-2 dark:bg-gray-800 dark:text-gray-300",
  ordered: "bg-ws-blue-bg text-ws-blue",
  received: "bg-ws-green-bg text-ws-green",
  cancelled: "bg-ws-red-bg text-ws-red",
};

function poTotal(items: POItem[]) {
  return items.reduce((s, it) => s + it.quantity * it.unit_cost, 0);
}

export function PurchaseOrderManager({
  orders,
  suppliers,
  products,
  canEdit,
  orderableSupplierIds = [],
}: {
  orders: PORow[];
  suppliers: POSupplier[];
  products: POProduct[];
  canEdit: boolean;
  /** Suppliers with ordering set up and switched on. */
  orderableSupplierIds?: string[];
}) {
  const orderable = new Set(orderableSupplierIds);
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
            <POCard key={po.id} po={po} canEdit={canEdit} canSend={!!po.supplierId && orderable.has(po.supplierId)} />
          ))}
        </div>
      )}
    </div>
  );
}

function POCard({ po, canEdit, canSend }: { po: PORow; canEdit: boolean; canSend: boolean }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Punch-out hand-off: the order hasn't been sent, the supplier's basket is
  // just a click away — rendered as a link rather than auto-opened so the
  // browser doesn't swallow it as a popup.
  const [punchoutUrl, setPunchoutUrl] = useState<string | null>(null);
  const [sentNote, setSentNote] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [confirmationText, setConfirmationText] = useState("");
  const [importNote, setImportNote] = useState<string | null>(null);

  function send() {
    setError(null);
    setPunchoutUrl(null);
    setSentNote(null);
    startTransition(async () => {
      const r = await sendPurchaseOrderToSupplier(po.id);
      if ("error" in r) {
        setError(r.error);
        return;
      }
      if (r.channel === "punchout") {
        setPunchoutUrl(r.url);
        setSentNote("Nothing sent yet — finish the order in the supplier's basket, then mark it ordered.");
      } else {
        setSentNote(`Order emailed to ${r.sentTo}.`);
      }
      router.refresh();
    });
  }

  function importConfirmation() {
    setError(null);
    setImportNote(null);
    startTransition(async () => {
      const r = await importSupplierConfirmation(po.id, confirmationText);
      if ("error" in r) {
        setError(r.error);
        return;
      }
      const parts = [
        r.supplierOrderRef ? `Reference ${r.supplierOrderRef}` : null,
        `${r.matched} line${r.matched === 1 ? "" : "s"} matched`,
        r.costsChanged > 0 ? `${r.costsChanged} cost${r.costsChanged === 1 ? "" : "s"} updated` : "no cost changes",
        r.unmatched > 0 ? `${r.unmatched} line${r.unmatched === 1 ? "" : "s"} couldn't be matched` : null,
      ].filter(Boolean);
      setImportNote(parts.join(" · "));
      setConfirmationText("");
      setShowImport(false);
      router.refresh();
    });
  }

  async function run(fn: () => Promise<{ error: string } | { success: true }>, confirmOpts?: ConfirmOptions) {
    if (confirmOpts && !(await confirm(confirmOpts))) return;
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

          {(po.supplierOrderRef || po.sentAt) && (
            <p className="mt-2 text-xs text-muted-foreground">
              {po.sentAt && `Sent ${fmtDate(po.sentAt)}${po.sentChannel ? ` by ${po.sentChannel === "email" ? "email" : "punch-out"}` : ""}`}
              {po.sentAt && po.supplierOrderRef && " · "}
              {po.supplierOrderRef && `Supplier ref ${po.supplierOrderRef}`}
              {po.confirmationImportedAt && ` · Confirmed ${fmtDate(po.confirmationImportedAt)}`}
            </p>
          )}

          {canEdit && (
            <div className="mt-3 flex flex-wrap gap-2">
              {po.status === "draft" && canSend && (
                <Button size="sm" variant="outline" disabled={pending} onClick={send}>
                  <Send className="mr-1.5 h-4 w-4" /> Send to supplier
                </Button>
              )}
              {po.status !== "received" && (
                <Button size="sm" variant="outline" disabled={pending} onClick={() => setShowImport((v) => !v)}>
                  <ClipboardPaste className="mr-1.5 h-4 w-4" /> Import confirmation
                </Button>
              )}
              {po.status === "draft" && (
                <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => markPurchaseOrderOrdered(po.id))}>
                  Mark ordered
                </Button>
              )}
              {(po.status === "draft" || po.status === "ordered") && (
                <Button size="sm" disabled={pending} onClick={() => run(() => receivePurchaseOrder(po.id), { title: `Receive ${po.reference || "this order"}?`, description: "Stock levels for its parts are increased.", confirmLabel: "Receive order" })}>
                  <PackageCheck className="mr-1.5 h-4 w-4" /> Receive into stock
                </Button>
              )}
              {po.status !== "received" && (
                <Button size="sm" variant="destructive" disabled={pending} onClick={() => run(() => deletePurchaseOrder(po.id), { title: `Delete ${po.reference || "this purchase order"}?`, description: "The order and its lines are removed. Stock is not adjusted.", confirmLabel: "Delete order", destructive: true })}>
                  Delete
                </Button>
              )}
              {po.receivedAt && <span className="self-center text-xs text-muted-foreground">Received {fmtDate(po.receivedAt)}</span>}
            </div>
          )}

          {sentNote && <p className="mt-2 text-sm text-ws-green">{sentNote}</p>}
          {punchoutUrl && (
            <a
              href={punchoutUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1.5 text-sm text-ws-blue underline"
            >
              Open supplier basket <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}

          {showImport && canEdit && (
            <div className="mt-3 rounded-lg border p-3">
              <Label htmlFor={`confirmation-${po.id}`}>Supplier confirmation</Label>
              <p className="mb-2 text-xs text-muted-foreground">
                Paste the confirmation email or order printout. We read the supplier&apos;s reference and update line
                costs where a line matches — anything we can&apos;t match is reported, not guessed.
              </p>
              <textarea
                id={`confirmation-${po.id}`}
                value={confirmationText}
                onChange={(e) => setConfirmationText(e.target.value)}
                rows={6}
                disabled={pending}
                className="w-full rounded border bg-background p-2 font-mono text-xs"
                placeholder={"Our order reference: GSF-889321\n2 x Brake Disc Pair Front (BD-9921) £42.50 each"}
              />
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={importConfirmation} loading={pending} disabled={!confirmationText.trim()}>
                  Import
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowImport(false)} disabled={pending}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {importNote && <p className="mt-2 text-sm text-ws-green">{importNote}</p>}
          {error && <p className="mt-2 text-sm text-ws-red">{error}</p>}
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
            <button type="button" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, i) => i !== idx) : ls))} disabled={pending} className="text-muted-foreground hover:text-ws-red" aria-label="Remove line">
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
      {error && <p className="text-sm text-ws-red">{error}</p>}
    </div>
  );
}
