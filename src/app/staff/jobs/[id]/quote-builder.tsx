"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Video, Plus, Trash2, Send, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { prepareQuoteUpload, createQuote, sendQuoteWithToken, type QuoteItemInput } from "./quote-actions";

type Product = { id: string; name: string; unit_price: number; category: string };

type Phase = "idle" | "uploading" | "drafting" | "sending" | "sent" | "error";

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

const inputClass = "w-full rounded-md border border-black/20 dark:border-white/25 bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

export function QuoteBuilder({
  jobId,
  products,
}: {
  jobId: string;
  products: Product[];
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Upload state
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);
  const [pendingQuoteId, setPendingQuoteId] = useState<string | null>(null);
  const [videoMime, setVideoMime] = useState<string | null>(null);
  const [videoSize, setVideoSize] = useState<number>(0);
  const [uploadPercent, setUploadPercent] = useState(0);

  // Draft state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [items, setItems] = useState<DraftItem[]>([newDraftItem()]);

  // Sent state
  const [customerUrl, setCustomerUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const subtotal = items.reduce(
    (sum, it) => sum + (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_price) || 0),
    0,
  );
  const vat = subtotal * 0.2;
  const total = subtotal + vat;

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const ext = file.name.split(".").pop()?.toLowerCase() || "mp4";
    setVideoMime(file.type);
    setVideoSize(file.size);
    setUploadPercent(0);
    setPhase("uploading");

    startTransition(async () => {
      const prep = await prepareQuoteUpload(jobId, file.type, file.size, ext);
      if ("error" in prep) {
        setError(prep.error);
        setPhase("error");
        return;
      }
      setUploadedPath(prep.path);
      setPendingQuoteId(prep.quoteId);

      const xhr = new XMLHttpRequest();
      xhr.open("PUT", prep.uploadUrl, true);
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) setUploadPercent(Math.round((ev.loaded / ev.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          setUploadPercent(100);
          setPhase("drafting");
        } else {
          setError(`Upload failed (HTTP ${xhr.status}).`);
          setPhase("error");
        }
      };
      xhr.onerror = () => {
        setError("Upload failed — check connection and retry.");
        setPhase("error");
      };
      xhr.send(file);
    });
  }

  function updateItem(idx: number, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function pickProduct(idx: number, productId: string) {
    if (!productId) {
      updateItem(idx, { product_id: "" });
      return;
    }
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    updateItem(idx, {
      product_id: productId,
      description: p.name,
      type: "part",
      unit_price: String(p.unit_price),
    });
  }

  function addItem() {
    setItems((prev) => [...prev, newDraftItem()]);
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleSend() {
    if (!uploadedPath || !pendingQuoteId || !videoMime) {
      setError("Upload incomplete.");
      return;
    }
    const parsed: QuoteItemInput[] = items.map((it) => ({
      description: it.description.trim(),
      type: it.type,
      quantity: parseFloat(it.quantity),
      unit_price: parseFloat(it.unit_price),
      product_id: it.product_id || null,
    }));
    if (parsed.some((it) => !it.description || !Number.isFinite(it.quantity) || it.quantity <= 0)) {
      setError("Fill in every item before sending.");
      return;
    }

    setError(null);
    setPhase("sending");
    startTransition(async () => {
      const created = await createQuote({
        jobId,
        quoteId: pendingQuoteId,
        videoPath: uploadedPath,
        videoMime,
        videoSizeBytes: videoSize,
        title: title.trim() || undefined,
        description: description.trim() || undefined,
        items: parsed,
      });
      if ("error" in created) {
        setError(created.error);
        setPhase("error");
        return;
      }

      // Extract token from the URL the server returned (only available right now).
      const url = new URL(created.customerUrl);
      const token = url.searchParams.get("t") ?? "";
      const sent = await sendQuoteWithToken(created.quoteId, token);
      if ("error" in sent) {
        setError(`Quote created but notification failed: ${sent.error}`);
        setCustomerUrl(created.customerUrl);
        setPhase("sent");
        return;
      }

      setCustomerUrl(created.customerUrl);
      setPhase("sent");
    });
  }

  function copyLink() {
    if (!customerUrl) return;
    navigator.clipboard.writeText(customerUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function reset() {
    setPhase("idle");
    setError(null);
    setUploadedPath(null);
    setPendingQuoteId(null);
    setVideoMime(null);
    setVideoSize(0);
    setUploadPercent(0);
    setTitle("");
    setDescription("");
    setItems([newDraftItem()]);
    setCustomerUrl(null);
    setCopied(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    router.refresh();
  }

  return (
    <section className="rounded-lg border p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        <Video className="h-4 w-4" /> Mid-job upsell
        <span className="ml-auto text-xs text-muted-foreground normal-case tracking-normal">
          Record a quick video + quote, customer approves remotely
        </span>
      </h2>

      {phase === "idle" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Found extra work? Record a short clip (≤ 80&nbsp;MB, ≤ 90 sec) showing what you found, attach line items, and the customer can approve or decline from their phone.
          </p>
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm,video/*"
              capture="environment"
              onChange={handleFile}
              disabled={pending}
              className="hidden"
              id="quote-video"
            />
            <label
              htmlFor="quote-video"
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium cursor-pointer hover:opacity-90 disabled:opacity-50"
            >
              <Video className="h-4 w-4" /> Record / upload video
            </label>
          </div>
        </div>
      )}

      {phase === "uploading" && (
        <div className="flex flex-col gap-2">
          <p className="text-sm">Uploading video… {uploadPercent}%</p>
          <div className="h-2 w-full rounded bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${uploadPercent}%` }} />
          </div>
        </div>
      )}

      {phase === "drafting" && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-green-700 dark:text-green-400">✓ Video uploaded. Add line items the customer needs to approve.</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="quote-title" className="text-xs">Title (shown to customer)</Label>
              <Input
                id="quote-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Worn front brake pads"
                disabled={pending}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="quote-desc" className="text-xs">Description (optional)</Label>
              <Input
                id="quote-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What you found in the video"
                disabled={pending}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Items</div>
            {items.map((it, idx) => (
              <div key={idx} className="rounded-md border p-3 flex flex-col gap-2 bg-muted/10">
                {products.length > 0 && (
                  <select
                    value={it.product_id}
                    onChange={(e) => pickProduct(idx, e.target.value)}
                    disabled={pending}
                    className={inputClass}
                  >
                    <option value="">— Custom item / no product —</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {formatGBP(p.unit_price)}
                      </option>
                    ))}
                  </select>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_90px_110px_auto] gap-2 items-end">
                  <Input
                    placeholder="Description"
                    value={it.description}
                    onChange={(e) => updateItem(idx, { description: e.target.value, product_id: it.product_id ? "" : it.product_id })}
                    required
                    disabled={pending}
                  />
                  <select
                    value={it.type}
                    onChange={(e) => updateItem(idx, { type: e.target.value as "part" | "labour" | "other" })}
                    disabled={pending}
                    className={inputClass}
                  >
                    <option value="part">Part</option>
                    <option value="labour">Labour</option>
                    <option value="other">Other</option>
                  </select>
                  <Input
                    type="number"
                    step="any"
                    min="0.01"
                    value={it.quantity}
                    onChange={(e) => updateItem(idx, { quantity: e.target.value })}
                    disabled={pending}
                    placeholder="Qty"
                  />
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={it.unit_price}
                    onChange={(e) => updateItem(idx, { unit_price: e.target.value })}
                    onFocus={(e) => {
                      if (it.unit_price === "0" || it.unit_price === "0.00") {
                        updateItem(idx, { unit_price: "" });
                        e.currentTarget.select();
                      }
                    }}
                    onBlur={() => {
                      if (it.unit_price === "") updateItem(idx, { unit_price: "0" });
                    }}
                    disabled={pending}
                    placeholder="Unit £"
                  />
                  <button
                    type="button"
                    onClick={() => removeItem(idx)}
                    disabled={pending || items.length === 1}
                    className="text-muted-foreground hover:text-red-600 disabled:opacity-30 h-9 px-2"
                    aria-label="Remove item"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addItem} disabled={pending} className="self-start">
              <Plus className="mr-1 h-4 w-4" /> Add item
            </Button>
          </div>

          <div className="rounded-md border bg-muted/20 p-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{formatGBP(subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">VAT (20%)</span><span className="tabular-nums">{formatGBP(vat)}</span></div>
            <div className="flex justify-between font-semibold mt-1 pt-1 border-t"><span>Total</span><span className="tabular-nums">{formatGBP(total)}</span></div>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleSend} disabled={pending}>
              <Send className="mr-2 h-4 w-4" /> Send to customer
            </Button>
            <Button variant="outline" onClick={reset} disabled={pending}>
              Discard
            </Button>
          </div>
        </div>
      )}

      {phase === "sending" && (
        <p className="text-sm text-muted-foreground">Saving quote + notifying customer…</p>
      )}

      {phase === "sent" && customerUrl && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-green-700 dark:text-green-400 flex items-center gap-2">
            <Check className="h-4 w-4" /> Quote sent — customer notified via email + SMS.
          </p>
          <div className="rounded-md border bg-muted/20 p-2 flex items-center gap-2">
            <span className="text-xs text-muted-foreground shrink-0">Customer link:</span>
            <input
              readOnly
              value={customerUrl}
              className="flex-1 bg-transparent text-xs font-mono outline-none"
            />
            <Button size="sm" variant="outline" onClick={copyLink}>
              <Copy className="h-3 w-3 mr-1" /> {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Save this link — it can&rsquo;t be retrieved again. To resend, cancel this quote and create a new one.
          </p>
          <Button variant="outline" onClick={reset} className="self-start">Done</Button>
        </div>
      )}

      {phase === "error" && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-red-600">{error}</p>
          <Button variant="outline" onClick={reset} className="self-start">Try again</Button>
        </div>
      )}
    </section>
  );
}
