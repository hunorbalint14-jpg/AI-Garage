// Pure inventory helpers. No server/DB imports so this is safe to import from
// both server and client components.

// A product is low on stock when a reorder threshold is set and current stock
// is at or below it. No threshold (null) → never flagged low here (callers can
// still treat 0 as out-of-stock separately).
export function isLowStock(stockQty: number, reorderAt: number | null): boolean {
  return reorderAt != null && stockQty <= reorderAt;
}
