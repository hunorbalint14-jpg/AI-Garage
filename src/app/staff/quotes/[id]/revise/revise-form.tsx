"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Send, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { reviseQuote, type StandaloneQuoteItemInput, type QuoteNotifyChannel } from "../../actions";

type DraftItem = {
  description: string;
  type: "part" | "labour" | "other";
  quantity: string;
  unit_price: string;
  product_id: string;
};

const newDraftItem = (): DraftItem => ({
  description: "",
  type: "part",
  quantity: "1",
  unit_price: "0",
  product_id: "",
});

function formatGBP(n: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

const inputClass =
  "w-full rounded-md border border-black/20 dark:border-white/25 bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

export function ReviseForm({
  quoteId,
  initialTitle,
  initialDescription,
  initialCustomerMessage,
  initialItems,
  customerName,
  hasEmail,
  hasPhone,
}: {
  quoteId: string;
  initialTitle: string;
  initialDescription: string;
  initialCustomerMessage: string;
  initialItems: { description: string; type: "part" | "labour" | "other"; quantity: number; unit_price: number; product_id: string | null }[];
  customerName: string | null;
  hasEmail: boolean;
  hasPhone: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sentInfo, setSentInfo] = useState<{ channels: string[]; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [customerMessage, setCustomerMessage] = useState(initialCustomerMessage);
  const [revisionNote, setRevisionNote] = useState("");
  const [items, setItems] = useState<DraftItem[]>(
    initialItems.length
      ? initialItems.map((it) => ({
          description: it.description,
          type: it.type,
          quantity: String(it.quantity),
          unit_price: String(it.unit_price),
          product_id: it.product_id ?? "",
        }))
      : [newDraftItem()],
  );
  const [channels, setChannels] = useState<Record<QuoteNotifyChannel, boolean>>({
    email: hasEmail,
    sms: hasPhone,
    whatsapp: false,
  });

  const subtotal = items.reduce(
    (sum, it) => sum + (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_price) || 0),
    0,
  );

  function updateItem(idx: number, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function addItem() {
    setItems((prev) => [...prev, newDraftItem()]);
  }
  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!revisionNote.trim()) {
      setError("Describe what changed — the customer sees this note.");
      return;
    }
    const selected = (Object.keys(channels) as QuoteNotifyChannel[]).filter((c) => channels[c]);
    if (selected.length === 0) {
      setError("Select at least one channel.");
      return;
    }
    const payload: StandaloneQuoteItemInput[] = items.map((it) => ({
      description: it.description,
      type: it.type,
      quantity: parseFloat(it.quantity) || 0,
      unit_price: parseFloat(it.unit_price) || 0,
      product_id: it.product_id || null,
    }));
    startTransition(async () => {
      const result = await reviseQuote({
        quoteId,
        title,
        description,
        customerMessage,
        items: payload,
        revisionNote,
        channels: selected,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setSentInfo({ channels: result.channels, url: result.customerUrl });
    });
  }

  function copyLink() {
    if (!sentInfo) return;
    navigator.clipboard.writeText(sentInfo.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (sentInfo) {
    return (
      <div className="rounded-lg border p-4 flex flex-col gap-3">
        {sentInfo.channels.length > 0 ? (
          <p className="text-sm text-green-700">
            Revision sent via {sentInfo.channels.join(" + ")}.
          </p>
        ) : (
          <p className="text-sm text-amber-700">
            The revision was saved and the old link is void, but no channel delivered — share the new
            link with the customer manually.
          </p>
        )}
        <div className="rounded-md border bg-muted/20 p-2 flex items-center gap-2">
          <span className="text-xs text-muted-foreground shrink-0">New customer link (mint-once):</span>
          <input readOnly value={sentInfo.url} className="flex-1 bg-transparent text-xs font-mono outline-none" />
          <Button size="sm" variant="outline" onClick={copyLink}>
            <Copy className="h-3 w-3 mr-1" /> {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <div>
          <Button variant="outline" onClick={() => router.push(`/staff/quotes/${quoteId}`)}>
            Back to quote
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="title">Title</Label>
        <input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={pending}
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="customerMessage">Message to customer</Label>
        <textarea
          id="customerMessage"
          rows={3}
          value={customerMessage}
          onChange={(e) => setCustomerMessage(e.target.value)}
          disabled={pending}
          className={inputClass + " resize-none"}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">Staff notes (internal)</Label>
        <textarea
          id="description"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={pending}
          className={inputClass + " resize-none"}
        />
      </div>

      <section className="rounded-lg border p-4 flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Line items</h2>
        {items.map((it, idx) => (
          <div key={idx} className="grid grid-cols-[1fr_110px_70px_100px_36px] items-center gap-2">
            <input
              placeholder="Description"
              value={it.description}
              onChange={(e) => updateItem(idx, { description: e.target.value })}
              disabled={pending}
              className={inputClass}
            />
            <select
              value={it.type}
              onChange={(e) => updateItem(idx, { type: e.target.value as DraftItem["type"] })}
              disabled={pending}
              className={inputClass}
            >
              <option value="part">Part</option>
              <option value="labour">Labour</option>
              <option value="other">Other</option>
            </select>
            <input
              type="number"
              min="0"
              step="0.25"
              value={it.quantity}
              onChange={(e) => updateItem(idx, { quantity: e.target.value })}
              disabled={pending}
              className={inputClass}
              aria-label="Quantity"
            />
            <input
              type="number"
              min="0"
              step="0.01"
              value={it.unit_price}
              onChange={(e) => updateItem(idx, { unit_price: e.target.value })}
              disabled={pending}
              className={inputClass}
              aria-label="Unit price"
            />
            <button
              type="button"
              onClick={() => removeItem(idx)}
              disabled={pending || items.length === 1}
              aria-label="Remove item"
              className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <Button type="button" size="sm" variant="outline" onClick={addItem} disabled={pending}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add item
          </Button>
          <p className="text-sm text-muted-foreground">
            Subtotal <span className="font-semibold text-foreground tabular-nums">{formatGBP(subtotal)}</span>{" "}
            · VAT + total recalculated on send
          </p>
        </div>
      </section>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="revisionNote">
          What changed? <span className="text-red-600">*</span>
        </Label>
        <textarea
          id="revisionNote"
          rows={2}
          required
          placeholder="e.g. Added rear brake pads; removed wiper replacement as discussed"
          value={revisionNote}
          onChange={(e) => setRevisionNote(e.target.value)}
          disabled={pending}
          className={inputClass + " resize-none"}
        />
        <p className="text-xs text-muted-foreground">
          Shown to {customerName ?? "the customer"} on the updated quote and in the notification.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Notify via</Label>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className={`flex items-center gap-2 ${hasEmail ? "" : "opacity-50"}`}>
            <input
              type="checkbox"
              checked={channels.email}
              disabled={pending || !hasEmail}
              onChange={(e) => setChannels((c) => ({ ...c, email: e.target.checked }))}
            />
            Email{!hasEmail && " (no address)"}
          </label>
          <label className={`flex items-center gap-2 ${hasPhone ? "" : "opacity-50"}`}>
            <input
              type="checkbox"
              checked={channels.sms}
              disabled={pending || !hasPhone}
              onChange={(e) => setChannels((c) => ({ ...c, sms: e.target.checked }))}
            />
            SMS{!hasPhone && " (no phone)"}
          </label>
          <label className={`flex items-center gap-2 ${hasPhone ? "" : "opacity-50"}`}>
            <input
              type="checkbox"
              checked={channels.whatsapp}
              disabled={pending || !hasPhone}
              onChange={(e) => setChannels((c) => ({ ...c, whatsapp: e.target.checked }))}
            />
            WhatsApp{!hasPhone && " (no phone)"}
          </label>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" loading={pending}>
          <Send className="mr-2 h-4 w-4" /> Send revision
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => router.push(`/staff/quotes/${quoteId}`)}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
