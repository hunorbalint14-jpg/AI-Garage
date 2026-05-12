"use client";

import { useState, useTransition, useMemo } from "react";
import { Plus, Search, Trash2, ShoppingCart, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createProduct, updateProduct, deleteProduct, adjustStock } from "./actions";
import { PRODUCT_CATEGORIES, SUPPLIERS } from "./constants";

type Product = {
  id: string;
  name: string;
  category: string;
  sku: string | null;
  supplier: string | null;
  unit_price: number;
  cost_price: number | null;
  stock_qty: number;
  active: boolean;
};

const fmt = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

export function ProductManager({ products, canEdit }: { products: Product[]; canEdit: boolean }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [showAdd, setShowAdd] = useState(false);

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (category !== "all" && p.category !== category) return false;
      if (query) {
        const q = query.toLowerCase();
        if (!p.name.toLowerCase().includes(q) && !p.sku?.toLowerCase().includes(q) && !p.supplier?.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [products, query, category]);

  const totalStockValue = products.reduce((sum, p) => sum + (p.cost_price ?? 0) * p.stock_qty, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="Products" value={String(products.length)} />
        <Stat label="In stock" value={String(products.reduce((s, p) => s + (p.stock_qty > 0 ? 1 : 0), 0))} />
        <Stat label="Low stock" value={String(products.filter((p) => p.stock_qty === 0).length)} accent="text-amber-600" />
        <Stat label="Stock value" value={fmt(totalStockValue)} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, SKU, supplier…"
            className="pl-9"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="all">All categories</option>
          {PRODUCT_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        {canEdit && (
          <Button onClick={() => setShowAdd((v) => !v)} className="ml-auto">
            <Plus className="mr-1.5 h-4 w-4" />
            {showAdd ? "Cancel" : "Add product"}
          </Button>
        )}
      </div>

      {showAdd && canEdit && <AddProductForm onDone={() => setShowAdd(false)} />}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[800px] text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 font-medium">SKU</th>
              <th className="px-3 py-2 font-medium text-right">Cost</th>
              <th className="px-3 py-2 font-medium text-right">Price</th>
              <th className="px-3 py-2 font-medium text-right">Stock</th>
              <th className="px-3 py-2 font-medium">Order online</th>
              {canEdit && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">No products match.</td></tr>
            ) : (
              filtered.map((p) => (
                <ProductRow key={p.id} product={p} canEdit={canEdit} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-bold ${accent ?? ""}`}>{value}</div>
    </div>
  );
}

function ProductRow({ product, canEdit }: { product: Product; canEdit: boolean }) {
  const [price, setPrice] = useState(product.unit_price);
  const [cost, setCost] = useState(product.cost_price ?? 0);
  const [sku, setSku] = useState(product.sku ?? "");
  const [pending, startTransition] = useTransition();
  const [supplierOpen, setSupplierOpen] = useState(false);

  function savePrice(next: number) {
    if (next === product.unit_price) return;
    startTransition(() => updateProduct(product.id, { unit_price: next }));
  }
  function saveCost(next: number) {
    if (next === (product.cost_price ?? 0)) return;
    startTransition(() => updateProduct(product.id, { cost_price: next }));
  }
  function saveSku(next: string) {
    if (next === (product.sku ?? "")) return;
    startTransition(() => updateProduct(product.id, { sku: next || null }));
  }

  function handleDelete() {
    if (!confirm(`Delete "${product.name}"?`)) return;
    startTransition(() => deleteProduct(product.id));
  }

  function handleStock(delta: number) {
    startTransition(() => adjustStock(product.id, delta));
  }

  const stockClass = product.stock_qty === 0 ? "text-red-600" : product.stock_qty < 3 ? "text-amber-600" : "";

  return (
    <tr className="border-t">
      <td className="px-3 py-2">{product.name}</td>
      <td className="px-3 py-2 text-xs text-muted-foreground">{product.category}</td>
      <td className="px-3 py-2">
        {canEdit ? (
          <input
            type="text"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            onBlur={() => saveSku(sku)}
            placeholder="—"
            className="w-24 rounded border bg-background px-2 py-1 text-xs font-mono"
          />
        ) : (
          <span className="font-mono text-xs">{product.sku ?? "—"}</span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        {canEdit ? (
          <input
            type="number"
            step="0.01"
            min="0"
            value={cost}
            onChange={(e) => setCost(parseFloat(e.target.value) || 0)}
            onBlur={() => saveCost(cost)}
            className="w-20 rounded border bg-background px-2 py-1 text-right text-xs tabular-nums"
          />
        ) : (
          <span className="tabular-nums">{fmt(product.cost_price ?? 0)}</span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        {canEdit ? (
          <input
            type="number"
            step="0.01"
            min="0"
            value={price}
            onChange={(e) => setPrice(parseFloat(e.target.value) || 0)}
            onBlur={() => savePrice(price)}
            className="w-20 rounded border bg-background px-2 py-1 text-right text-xs tabular-nums font-medium"
          />
        ) : (
          <span className="tabular-nums font-medium">{fmt(product.unit_price)}</span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        {canEdit ? (
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={() => handleStock(-1)}
              disabled={pending || product.stock_qty === 0}
              className="rounded border px-1.5 text-xs hover:bg-muted disabled:opacity-30"
            >−</button>
            <span className={`tabular-nums w-8 text-center ${stockClass}`}>{product.stock_qty}</span>
            <button
              type="button"
              onClick={() => handleStock(1)}
              disabled={pending}
              className="rounded border px-1.5 text-xs hover:bg-muted disabled:opacity-30"
            >+</button>
          </div>
        ) : (
          <span className={`tabular-nums ${stockClass}`}>{product.stock_qty}</span>
        )}
      </td>
      <td className="px-3 py-2 relative">
        <button
          type="button"
          onClick={() => setSupplierOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted"
        >
          <ShoppingCart className="h-3 w-3" />
          Order
          <ChevronDown className="h-3 w-3" />
        </button>
        {supplierOpen && (
          <div className="absolute right-0 z-10 mt-1 w-48 rounded-md border bg-popover text-popover-foreground shadow-lg">
            {SUPPLIERS.map((s) => (
              <a
                key={s.id}
                href={s.searchUrl(product.sku || product.name)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setSupplierOpen(false)}
                className="block px-3 py-2 text-xs hover:bg-muted"
              >
                {s.name} →
              </a>
            ))}
          </div>
        )}
      </td>
      {canEdit && (
        <td className="px-3 py-2 text-right">
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            className="text-muted-foreground hover:text-red-600"
            aria-label="Delete product"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </td>
      )}
    </tr>
  );
}

function AddProductForm({ onDone }: { onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createProduct(formData);
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
        <Label htmlFor="category">Category *</Label>
        <select id="category" name="category" required disabled={pending} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
          {PRODUCT_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="sku">SKU</Label>
        <Input id="sku" name="sku" disabled={pending} />
      </div>
      <div>
        <Label htmlFor="supplier">Supplier</Label>
        <Input id="supplier" name="supplier" disabled={pending} />
      </div>
      <div>
        <Label htmlFor="unitPrice">Sell price (£) *</Label>
        <Input id="unitPrice" name="unitPrice" type="number" step="0.01" min="0" required disabled={pending} />
      </div>
      <div>
        <Label htmlFor="costPrice">Cost price (£)</Label>
        <Input id="costPrice" name="costPrice" type="number" step="0.01" min="0" disabled={pending} />
      </div>
      <div>
        <Label htmlFor="stockQty">Stock</Label>
        <Input id="stockQty" name="stockQty" type="number" min="0" defaultValue={0} disabled={pending} />
      </div>
      <div className="sm:col-span-2 flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Adding…" : "Add product"}</Button>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
      </div>
      {error && <p className="sm:col-span-2 text-sm text-red-600">{error}</p>}
    </form>
  );
}
