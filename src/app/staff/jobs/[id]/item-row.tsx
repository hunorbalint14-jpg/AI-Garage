"use client";

import { useState, useTransition } from "react";
import { updateJobItem } from "../actions";

const fmt = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

export function ItemRow({
  jobId,
  itemId,
  description,
  type,
  initialQuantity,
  initialUnitPrice,
  editable,
  onRemove,
  removePending,
}: {
  jobId: string;
  itemId: string;
  description: string;
  type: string;
  initialQuantity: number;
  initialUnitPrice: number;
  editable: boolean;
  onRemove: () => void;
  removePending: boolean;
}) {
  const [qty, setQty] = useState(initialQuantity);
  const [price, setPrice] = useState(initialUnitPrice);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function save(nextQty: number, nextPrice: number) {
    if (nextQty === initialQuantity && nextPrice === initialUnitPrice) return;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateJobItem(jobId, itemId, nextQty, nextPrice);
      if ("error" in result) {
        setError(result.error);
        setQty(initialQuantity);
        setPrice(initialUnitPrice);
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      }
    });
  }

  const total = qty * price;

  if (!editable) {
    return (
      <tr className="border-t">
        <td className="px-4 py-2">{description}</td>
        <td className="px-4 py-2 capitalize text-muted-foreground">{type}</td>
        <td className="px-4 py-2 text-right tabular-nums">{qty}</td>
        <td className="px-4 py-2 text-right tabular-nums">{fmt(price)}</td>
        <td className="px-4 py-2 text-right tabular-nums font-medium">{fmt(total)}</td>
      </tr>
    );
  }

  return (
    <tr className="border-t">
      <td className="px-4 py-2">{description}</td>
      <td className="px-4 py-2 capitalize text-muted-foreground">{type}</td>
      <td className="px-4 py-2 text-right">
        <input
          type="number"
          step="0.25"
          min="0"
          value={qty}
          onChange={(e) => setQty(parseFloat(e.target.value) || 0)}
          onBlur={() => save(qty, price)}
          disabled={pending}
          className="w-20 rounded border bg-background px-2 py-1 text-right text-sm tabular-nums disabled:opacity-50"
        />
      </td>
      <td className="px-4 py-2 text-right">
        <input
          type="number"
          step="0.01"
          min="0"
          value={price}
          onChange={(e) => setPrice(parseFloat(e.target.value) || 0)}
          onBlur={() => save(qty, price)}
          disabled={pending}
          className="w-24 rounded border bg-background px-2 py-1 text-right text-sm tabular-nums disabled:opacity-50"
        />
      </td>
      <td className="px-4 py-2 text-right tabular-nums font-medium">
        {fmt(total)}
        {saved && <span className="ml-1 text-xs text-green-600">✓</span>}
        {error && <div className="text-xs text-red-600">{error}</div>}
      </td>
      <td className="px-4 py-2 text-right">
        <button
          type="button"
          onClick={onRemove}
          disabled={removePending || pending}
          className="text-xs text-red-600 underline"
        >
          Remove
        </button>
      </td>
    </tr>
  );
}
