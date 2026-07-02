"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Video, Plus, Trash2, Send, Check, Copy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { prepareQuoteUpload, createQuote, sendQuoteWithToken, type QuoteItemInput } from "./quote-actions";

type Product = { id: string; name: string; unit_price: number; category: string };

type Phase = "drafting" | "sending" | "sent" | "saved" | "error";

type DraftItem = {
  description: string;
  type: "part" | "labour" | "other";
  quantity: string;
  unit_price: string;
  product_id: string;
};

const newDraftItem = (): DraftItem => ({ description: "", type: "part", quantity: "1", unit_price: "0", product_id: "" });

function formatGBP(n: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

const inputClass = "w-full rounded-md border border-black/20 dark:border-white/25 bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

export function QuoteBuilder({ jobId, products }: { jobId: string; products: Product[] }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [phase, setPhase] = useState<Phase>("drafting");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Optional video state.
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);
  const [pendingQuoteId, setPendingQuoteId] = useState<string | null>(null);
  const [videoMime, setVideoMime] = useState<string | null>(null);
  const [videoSize, setVideoSize] = useState<number>(0);

  // Draft content.
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [items, setItems] = useState<DraftItem[]>([newDraftItem()]);

  // Outcome.
  const [customerUrl, setCustomerUrl] = useState<string | null>(null);
  const [resultQuoteId, setResultQuoteId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const subtotal = items.reduce((sum, it) => sum + (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_price) || 0), 0);
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
    setUploadingVideo(true);

    startTransition(async () => {
      const prep = await prepareQuoteUpload(jobId, file.type, file.size, ext);
      if ("error" in prep) {
        setError(prep.error);
        setUploadingVideo(false);
        return;
      }
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", prep.uploadUrl, true);
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) setUploadPercent(Math.round((ev.loaded / ev.total) * 100));
      };
      xhr.onload = () => {
        setUploadingVideo(false);
        if (xhr.status >= 200 && xhr.status < 300) {
          setUploadedPath(prep.path);
          setPendingQuoteId(prep.quoteId);
          setUploadPercent(100);
        } else {
          setError(`Upload failed (HTTP ${xhr.status}).`);
        }
      };
      xhr.onerror = () => {
        setUploadingVideo(false);
        setError("Upload failed — check connection and retry.");
      };
      xhr.send(file);
    });
  }

  function removeVideo() {
    setUploadedPath(null);
    setPendingQuoteId(null);
    setVideoMime(null);
    setVideoSize(0);
    setUploadPercent(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
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
    updateItem(idx, { product_id: productId, description: p.name, type: "part", unit_price: String(p.unit_price) });
  }

  function addItem() {
    setItems((prev) => [...prev, newDraftItem()]);
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function buildItems(): QuoteItemInput[] | null {
    const parsed: QuoteItemInput[] = items.map((it) => ({
      description: it.description.trim(),
      type: it.type,
      quantity: parseFloat(it.quantity),
      unit_price: parseFloat(it.unit_price),
      product_id: it.product_id || null,
    }));
    if (parsed.some((it) => !it.description || !Number.isFinite(it.quantity) || it.quantity <= 0)) {
      setError("Fill in every item (description + quantity) before saving.");
      return null;
    }
    return parsed;
  }

  function handleSubmit(mode: "draft" | "send") {
    if (uploadingVideo) {
      setError("Wait for the video upload to finish.");
      return;
    }
    const parsed = buildItems();
    if (!parsed) return;
    setError(null);
    setPhase("sending");

    startTransition(async () => {
      const created = await createQuote({
        jobId,
        quoteId: pendingQuoteId ?? undefined,
        videoPath: uploadedPath,
        videoMime,
        videoSizeBytes: videoSize || null,
        title: title.trim() || undefined,
        description: description.trim() || undefined,
        items: parsed,
        asDraft: mode === "draft",
      });
      if ("error" in created) {
        setError(created.error);
        setPhase("error");
        return;
      }
      setResultQuoteId(created.quoteId);

      if (mode === "draft") {
        setPhase("saved");
        return;
      }

      // Send: createQuote minted a token (in customerUrl); dispatch it.
      const url = created.customerUrl ? new URL(created.customerUrl) : null;
      const tokenParam = url?.searchParams.get("t") ?? "";
      const sent = await sendQuoteWithToken(created.quoteId, tokenParam);
      setCustomerUrl(created.customerUrl ?? null);
      if ("error" in sent) {
        setError(`Quote created but notification failed: ${sent.error}`);
      }
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
    setPhase("drafting");
    setError(null);
    removeVideo();
    setTitle("");
    setDescription("");
    setItems([newDraftItem()]);
    setCustomerUrl(null);
    setResultQuoteId(null);
    setCopied(false);
    router.refresh();
  }

  return (
    <section className="rounded-lg border p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        <Video className="h-4 w-4" /> Mid-job upsell
        <span className="ml-auto text-xs text-muted-foreground normal-case tracking-normal">
          Add a video + line items, save a draft or send for remote approval
        </span>
      </h2>

      {phase === "drafting" && (
        <div className="flex flex-col gap-4">
          {/* Optional video */}
          <div className="rounded-md border bg-muted/10 p-3">
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
            {uploadingVideo ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm">Uploading video… {uploadPercent}%</p>
                <div className="h-2 w-full rounded bg-muted overflow-hidden">
                  <div className="h-full bg-primary transition-all" style={{ width: `${uploadPercent}%` }} />
                </div>
              </div>
            ) : uploadedPath ? (
              <div className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 text-green-600" /> Video attached
                <button type="button" onClick={removeVideo} className="ml-auto text-muted-foreground hover:text-red-600 flex items-center gap-1 text-xs">
                  <X className="h-3 w-3" /> Remove
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Add a short video showing the work (optional, ≤ 80&nbsp;MB).</span>
                <label htmlFor="quote-video" className="inline-flex shrink-0 items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium cursor-pointer hover:bg-muted/50">
                  <Video className="h-4 w-4" /> Add video
                </label>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="quote-title" className="text-xs">Title (shown to customer)</Label>
              <Input id="quote-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Worn front brake pads" disabled={pending} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="quote-desc" className="text-xs">Description (optional)</Label>
              <Input id="quote-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What you found" disabled={pending} />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Items</div>
            {items.map((it, idx) => (
              <div key={idx} className="rounded-md border p-3 flex flex-col gap-2 bg-muted/10">
                {products.length > 0 && (
                  <select value={it.product_id} onChange={(e) => pickProduct(idx, e.target.value)} disabled={pending} className={inputClass}>
                    <option value="">— Custom item / no product —</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} · {formatGBP(p.unit_price)}</option>
                    ))}
                  </select>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_90px_110px_auto] gap-2 items-end">
                  <Input placeholder="Description" value={it.description} onChange={(e) => updateItem(idx, { description: e.target.value, product_id: it.product_id ? "" : it.product_id })} required disabled={pending} />
                  <select value={it.type} onChange={(e) => updateItem(idx, { type: e.target.value as "part" | "labour" | "other" })} disabled={pending} className={inputClass}>
                    <option value="part">Part</option>
                    <option value="labour">Labour</option>
                    <option value="other">Other</option>
                  </select>
                  <Input type="number" step="any" min="0.01" value={it.quantity} onChange={(e) => updateItem(idx, { quantity: e.target.value })} disabled={pending} placeholder="Qty" />
                  <Input
                    type="number" step="0.01" min="0" value={it.unit_price}
                    onChange={(e) => updateItem(idx, { unit_price: e.target.value })}
                    onFocus={(e) => { if (it.unit_price === "0" || it.unit_price === "0.00") { updateItem(idx, { unit_price: "" }); e.currentTarget.select(); } }}
                    onBlur={() => { if (it.unit_price === "") updateItem(idx, { unit_price: "0" }); }}
                    disabled={pending} placeholder="Unit £"
                  />
                  <button type="button" onClick={() => removeItem(idx)} disabled={pending || items.length === 1} className="text-muted-foreground hover:text-red-600 disabled:opacity-30 h-9 px-2" aria-label="Remove item">
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

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => handleSubmit("send")} disabled={pending}>
              <Send className="mr-2 h-4 w-4" /> Send to customer
            </Button>
            <Button variant="outline" onClick={() => handleSubmit("draft")} disabled={pending}>
              Save draft
            </Button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}

      {phase === "sending" && <p className="text-sm text-muted-foreground">Saving quote…</p>}

      {phase === "saved" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-green-700 dark:text-green-400 flex items-center gap-2">
            <Check className="h-4 w-4" /> Draft saved. Send it to the customer from the Quotes page when ready.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={reset} className="self-start">New quote</Button>
            {resultQuoteId && (
              <Button variant="outline" nativeButton={false} className="self-start" render={<Link href={`/staff/quotes/${resultQuoteId}`}>Open draft →</Link>} />
            )}
          </div>
        </div>
      )}

      {phase === "sent" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-green-700 dark:text-green-400 flex items-center gap-2">
            <Check className="h-4 w-4" /> {error ? "Quote created." : "Quote sent — customer notified via email + SMS."}
          </p>
          {error && <p className="text-sm text-amber-600">{error}</p>}
          {customerUrl && (
            <div className="rounded-md border bg-muted/20 p-2 flex items-center gap-2">
              <span className="text-xs text-muted-foreground shrink-0">Customer link:</span>
              <input readOnly value={customerUrl} className="flex-1 bg-transparent text-xs font-mono outline-none" />
              <Button size="sm" variant="outline" onClick={copyLink}><Copy className="h-3 w-3 mr-1" /> {copied ? "Copied" : "Copy"}</Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">Save this link — it can&rsquo;t be retrieved again.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={reset} className="self-start">Done</Button>
            {resultQuoteId && (
              <Button variant="outline" nativeButton={false} className="self-start" render={<Link href={`/staff/quotes/${resultQuoteId}`}>Manage in Quotes →</Link>} />
            )}
          </div>
        </div>
      )}

      {phase === "error" && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-red-600">{error}</p>
          <Button variant="outline" onClick={() => setPhase("drafting")} className="self-start">Back</Button>
        </div>
      )}
    </section>
  );
}
