"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Send, Save, Copy, Check, Video, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CustomerVehiclePicker } from "@/components/staff/customer-vehicle-picker";
import type { PickerCustomer } from "@/app/staff/customer-picker-actions";
import {
  prepareStandaloneQuoteUpload,
  createStandaloneQuote,
  sendFreshStandaloneQuote,
  type StandaloneQuoteItemInput,
} from "../actions";
import { suggestLabourTime } from "../../jobs/actions";
import { seedQuoteFromDiagnostic, type SeedFromDiagnosticResult } from "../ai-actions";
import { computeTotals, DEFAULT_VAT_RATE } from "@/lib/quote-service-shared";

type Product = { id: string; name: string; unit_price: number; category: string };

type DraftItem = {
  description: string;
  type: "part" | "labour" | "other";
  quantity: string;
  unit_price: string;
  product_id: string;
  // Set after an AI labour estimate — shown under the row, cleared on edit.
  ai_note?: string;
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

type Phase = "idle" | "uploading" | "sending" | "sent" | "error";

export function QuoteBuilder({
  products,
  defaultValidityDays,
}: {
  products: Product[];
  defaultValidityDays: number;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [selectedCustomer, setSelectedCustomer] = useState<PickerCustomer | null>(null);
  const [vehicleId, setVehicleId] = useState("");
  const customerId = selectedCustomer?.id ?? "";

  const [title, setTitle] = useState("");
  const [customerMessage, setCustomerMessage] = useState("");
  const [items, setItems] = useState<DraftItem[]>([newDraftItem()]);
  const [validityDays, setValidityDays] = useState(String(defaultValidityDays));

  // Optional video state
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [pendingQuoteId, setPendingQuoteId] = useState<string | null>(null);
  const [videoMime, setVideoMime] = useState<string | null>(null);
  const [videoSize, setVideoSize] = useState<number>(0);
  const [uploadPercent, setUploadPercent] = useState(0);

  const [customerUrl, setCustomerUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // AI assist (Phase 9): per-row labour estimates + seed-from-diagnostic.
  const [estimatingIdx, setEstimatingIdx] = useState<number | null>(null);
  const [symptom, setSymptom] = useState("");
  const [seeding, setSeeding] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [diagnosis, setDiagnosis] = useState<Extract<SeedFromDiagnosticResult, { success: true }>["diagnosis"] | null>(null);

  const selectedVehicle = selectedCustomer?.vehicles.find((v) => v.id === vehicleId) ?? null;
  const vehicleDescription = selectedVehicle
    ? [selectedVehicle.year, selectedVehicle.make, selectedVehicle.model].filter(Boolean).join(" ") || undefined
    : undefined;

  function handleEstimate(idx: number) {
    const desc = items[idx]?.description.trim();
    if (!desc) {
      setAiError("Type a description for the labour line first.");
      return;
    }
    setAiError(null);
    setEstimatingIdx(idx);
    startTransition(async () => {
      const result = await suggestLabourTime(desc, vehicleDescription);
      setEstimatingIdx(null);
      if ("error" in result) {
        setAiError(result.error);
        return;
      }
      updateItem(idx, { quantity: String(result.hours), ai_note: `AI estimate: ${result.hours} hrs — ${result.note}` });
    });
  }

  function handleSeedFromDiagnostic() {
    if (!symptom.trim()) {
      setAiError("Describe the symptom first.");
      return;
    }
    setAiError(null);
    setSeeding(true);
    startTransition(async () => {
      const result = await seedQuoteFromDiagnostic({
        symptom,
        vehicleDescription,
        vehicleReg: selectedVehicle?.registration ?? undefined,
      });
      setSeeding(false);
      if ("error" in result) {
        setAiError(result.error);
        return;
      }
      setDiagnosis(result.diagnosis);
      if (!title.trim()) setTitle(result.title);
      if (!customerMessage.trim()) setCustomerMessage(result.customerMessage);
      const seeded: DraftItem[] = result.items.map((it) => ({
        description: it.description,
        type: it.type,
        quantity: String(it.quantity),
        unit_price: String(it.unit_price),
        product_id: "",
        ai_note: `AI estimate: ${it.quantity} hrs — ${it.note}`,
      }));
      setItems((prev) => {
        const nonEmpty = prev.filter((it) => it.description.trim());
        return nonEmpty.length ? [...nonEmpty, ...seeded] : seeded;
      });
    });
  }

  // Same maths + rate the server uses at creation, so the preview can't drift.
  const { subtotal, vat, total } = computeTotals(
    items.map((it) => ({
      quantity: parseFloat(it.quantity) || 0,
      unit_price: parseFloat(it.unit_price) || 0,
    })),
    DEFAULT_VAT_RATE,
  );

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
  function addItem() { setItems((prev) => [...prev, newDraftItem()]); }
  function removeItem(idx: number) { setItems((prev) => prev.filter((_, i) => i !== idx)); }

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
      const prep = await prepareStandaloneQuoteUpload(file.type, file.size, ext);
      if ("error" in prep) {
        setError(prep.error);
        setPhase("error");
        return;
      }
      setVideoPath(prep.path);
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
          setPhase("idle");
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

  function parseItems(): { ok: true; items: StandaloneQuoteItemInput[] } | { ok: false; error: string } {
    if (!customerId) return { ok: false, error: "Pick a customer first." };
    const parsed: StandaloneQuoteItemInput[] = items.map((it) => ({
      description: it.description.trim(),
      type: it.type,
      quantity: parseFloat(it.quantity),
      unit_price: parseFloat(it.unit_price),
      product_id: it.product_id || null,
    }));
    if (parsed.some((it) => !it.description || !Number.isFinite(it.quantity) || it.quantity <= 0)) {
      return { ok: false, error: "Every line item needs a description and a quantity." };
    }
    return { ok: true, items: parsed };
  }

  function commonArgs(itemsParsed: StandaloneQuoteItemInput[]) {
    const days = Number(validityDays);
    return {
      quoteId: pendingQuoteId ?? undefined,
      customerId,
      vehicleId: vehicleId || null,
      title: title.trim() || undefined,
      customerMessage: customerMessage.trim() || undefined,
      items: itemsParsed,
      videoPath: videoPath ?? undefined,
      videoMime: videoMime ?? undefined,
      videoSizeBytes: videoSize || undefined,
      expiresInDays: Number.isFinite(days) && days > 0 && days <= 365 ? days : undefined,
    };
  }

  function handleSaveDraft() {
    const parsed = parseItems();
    if (!parsed.ok) { setError(parsed.error); return; }
    setError(null);
    startTransition(async () => {
      const created = await createStandaloneQuote({ ...commonArgs(parsed.items), sendImmediately: false });
      if ("error" in created) { setError(created.error); return; }
      router.push(`/staff/quotes/${created.quoteId}`);
    });
  }

  function handleSendNow() {
    const parsed = parseItems();
    if (!parsed.ok) { setError(parsed.error); return; }
    if (!selectedCustomer?.email && !selectedCustomer?.phone) {
      setError("Customer has no email or phone — add contact details first.");
      return;
    }
    setError(null);
    setPhase("sending");
    startTransition(async () => {
      const created = await createStandaloneQuote({ ...commonArgs(parsed.items), sendImmediately: true });
      if ("error" in created) {
        setError(created.error);
        setPhase("error");
        return;
      }
      if (!created.customerUrl) {
        setError("Quote created but customer URL missing — visit /staff/quotes/" + created.quoteId);
        setPhase("error");
        return;
      }
      // Dispatch email + SMS now using the token captured in the URL.
      const url = new URL(created.customerUrl);
      const token = url.searchParams.get("t") ?? "";
      const sent = await sendFreshStandaloneQuote(created.quoteId, token);
      if ("error" in sent) {
        setError(`Quote sent but notification failed: ${sent.error}`);
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

  if (phase === "sent" && customerUrl) {
    return (
      <section className="rounded-lg border p-5 flex flex-col gap-3">
        <p className="text-sm text-ws-green dark:text-green-400 flex items-center gap-2">
          <Check className="h-4 w-4" /> Quote sent — customer notified via email + SMS.
        </p>
        <div className="rounded-md border bg-muted/20 p-2 flex items-center gap-2">
          <span className="text-xs text-muted-foreground shrink-0">Customer link:</span>
          <input readOnly value={customerUrl} className="flex-1 bg-transparent text-xs font-mono outline-none" />
          <Button size="sm" variant="outline" onClick={copyLink}>
            <Copy className="h-3 w-3 mr-1" /> {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Save this link — it can&rsquo;t be retrieved again. To resend, cancel + recreate.
        </p>
        <div className="flex gap-2">
          <Button onClick={() => router.push("/staff/quotes")}>Back to quotes</Button>
          <Button variant="outline" onClick={() => router.push("/staff/quotes/new")}>New quote</Button>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-5">
      {/* Customer + vehicle */}
      <div className="rounded-lg border p-4 flex flex-col gap-3">
        <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ws-text-3">Customer & vehicle</h2>
        <CustomerVehiclePicker
          disabled={pending}
          vehicleLabel="Vehicle (optional)"
          hideVehicleUntilCustomer
          onCustomerChange={setSelectedCustomer}
          onVehicleChange={setVehicleId}
        />
      </div>

      {/* AI assist — seed the quote from a described symptom */}
      <div className="rounded-lg border p-4 flex flex-col gap-3">
        <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ws-text-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4" /> AI assist
        </h2>
        <p className="text-xs text-muted-foreground">
          Describe the customer&rsquo;s symptom and AI drafts a starting point — title, message, and a
          labour line with estimated hours. Everything stays editable; nothing is sent automatically.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            placeholder="e.g. Grinding noise from front when braking"
            value={symptom}
            onChange={(e) => setSymptom(e.target.value)}
            disabled={pending || seeding}
          />
          <Button
            type="button"
            variant="outline"
            onClick={handleSeedFromDiagnostic}
            loading={seeding}
            disabled={pending}
            className="shrink-0"
          >
            <Sparkles className="mr-2 h-4 w-4" /> Seed from diagnostic
          </Button>
        </div>
        {diagnosis && (
          <div className="rounded-md border bg-muted/20 p-3 text-sm flex flex-col gap-1.5">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ws-text-3">
              Likely causes ({diagnosis.urgency === "urgent" ? "urgent" : diagnosis.urgency === "soon" ? "see within 2 weeks" : "monitor"})
            </p>
            <ul className="list-disc pl-5">
              {diagnosis.likelyCauses.map((c, i) => (
                <li key={i}>
                  {c.cause} <span className="text-xs text-muted-foreground">({c.probability})</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Typical cost guide: {diagnosis.estimatedCost}. AI suggestion — verify before sending.
            </p>
          </div>
        )}
        {aiError && <p className="text-sm text-ws-red">{aiError}</p>}
      </div>

      {/* Title + message */}
      <div className="rounded-lg border p-4 flex flex-col gap-3">
        <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ws-text-3">Quote details</h2>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="title" className="text-xs">Title (shown to customer)</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Annual service + front brake pads"
            disabled={pending}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="customer-message" className="text-xs">Message to customer (optional)</Label>
          <textarea
            id="customer-message"
            rows={3}
            value={customerMessage}
            onChange={(e) => setCustomerMessage(e.target.value)}
            placeholder="e.g. Includes all parts and labour. Vehicle drop-off any weekday morning."
            disabled={pending}
            className={inputClass + " resize-none"}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="validity-days" className="text-xs">Valid for (days)</Label>
          <Input
            id="validity-days"
            type="number"
            min="1"
            max="365"
            value={validityDays}
            onChange={(e) => setValidityDays(e.target.value)}
            disabled={pending}
            className="w-32"
          />
        </div>
      </div>

      {/* Optional video */}
      <div className="rounded-lg border p-4 flex flex-col gap-3">
        <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ws-text-3 flex items-center gap-2">
          <Video className="h-4 w-4" /> Optional video
        </h2>
        {phase === "uploading" ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm">Uploading… {uploadPercent}%</p>
            <div className="h-2 w-full rounded bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${uploadPercent}%` }} />
            </div>
          </div>
        ) : videoPath ? (
          <div className="flex items-center justify-between rounded-md border bg-ws-green-bg p-2 text-sm">
            <span className="text-ws-green">✓ Video uploaded</span>
            <button type="button" onClick={() => { setVideoPath(null); setPendingQuoteId(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} className="text-xs underline text-muted-foreground">
              Remove
            </button>
          </div>
        ) : (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm,video/*"
              capture="environment"
              onChange={handleFile}
              disabled={pending}
              className="hidden"
              id="quote-video-input"
            />
            <label htmlFor="quote-video-input" className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer hover:bg-muted">
              <Video className="h-4 w-4" /> Record / upload (≤ 80 MB)
            </label>
            <p className="text-xs text-muted-foreground mt-1">Text-only quotes are fine — video is optional.</p>
          </div>
        )}
      </div>

      {/* Items */}
      <div className="rounded-lg border p-4 flex flex-col gap-3">
        <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ws-text-3">Items</h2>
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
                onChange={(e) => updateItem(idx, { description: e.target.value, product_id: it.product_id ? "" : it.product_id, ai_note: undefined })}
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
                onBlur={() => { if (it.unit_price === "") updateItem(idx, { unit_price: "0" }); }}
                disabled={pending}
                placeholder="Unit £"
              />
              <button
                type="button"
                onClick={() => removeItem(idx)}
                disabled={pending || items.length === 1}
                className="text-muted-foreground hover:text-ws-red disabled:opacity-30 h-9 px-2"
                aria-label="Remove item"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            {it.type === "labour" && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => handleEstimate(idx)}
                  loading={estimatingIdx === idx}
                  disabled={pending || estimatingIdx !== null}
                >
                  <Zap className="mr-1 h-3.5 w-3.5" /> Estimate hours
                </Button>
                {it.ai_note && <p className="text-xs text-muted-foreground">{it.ai_note}</p>}
              </div>
            )}
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={addItem} disabled={pending} className="self-start">
          <Plus className="mr-1 h-4 w-4" /> Add item
        </Button>

        <div className="rounded-md border bg-muted/20 p-3 text-sm mt-2">
          <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{formatGBP(subtotal)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">VAT (20%)</span><span className="tabular-nums">{formatGBP(vat)}</span></div>
          <div className="flex justify-between font-semibold mt-1 pt-1 border-t"><span>Total</span><span className="tabular-nums">{formatGBP(total)}</span></div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Button onClick={handleSendNow} disabled={pending || phase === "uploading"}>
          <Send className="mr-2 h-4 w-4" /> {phase === "sending" ? "Sending…" : "Send to customer"}
        </Button>
        <Button variant="outline" onClick={handleSaveDraft} disabled={pending || phase === "uploading"}>
          <Save className="mr-2 h-4 w-4" /> Save as draft
        </Button>
      </div>

      {error && <p className="text-sm text-ws-red">{error}</p>}
    </section>
  );
}
