"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { Camera, Plus, Sparkles, Trash2, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-provider";
import { InspectionQuotePanel } from "./quote-panel";
import { InspectionSendPanel } from "./send-panel";
import {
  updateInspectionItem,
  addInspectionFinding,
  removeInspectionFinding,
  sweepRemainingGreen,
  completeInspection,
  prepareInspectionPhoto,
  attachInspectionMedia,
  removeInspectionMedia,
  generateInspectionSummaries,
  rewriteInspectionFinding,
  updateInspectionSummary,
} from "./actions";

// eVHC tech capture (#497 Phase 2). Phone-in-the-workshop surface: big touch
// targets, one-thumb RAG grading, autosave on every interaction. The speed
// trick is the default-green sweep — the tech only touches exceptions and one
// tap confirms the rest.

export type Rag = "green" | "amber" | "red" | "not_checked";

export type CaptureItem = {
  id: string;
  section: string;
  label: string;
  rag: Rag;
  note: string;
  customerSummary: string;
  suggestedRepair: string | null;
  suggestedPrice: number | null;
  outcome: "none" | "quoted" | "approved" | "declined";
  adhoc: boolean;
  media: { id: string; url: string; path: string }[];
};

const RAG_OPTIONS: { value: Rag; label: string; on: string; off: string }[] = [
  { value: "green", label: "OK", on: "bg-green-500/25 text-ws-green border-green-500/50", off: "text-muted-foreground border-transparent" },
  { value: "amber", label: "Advise", on: "bg-amber-500/25 text-ws-amber border-amber-500/50", off: "text-muted-foreground border-transparent" },
  { value: "red", label: "Urgent", on: "bg-red-500/25 text-ws-red border-red-500/50", off: "text-muted-foreground border-transparent" },
];

// Downscale a photo to ≤1600px on the long edge before upload — workshop
// phone photos are 10MB+ raw and the report only needs screen resolution.
async function resizePhoto(file: File): Promise<{ blob: Blob; mime: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 1.5 * 1024 * 1024) return { blob: file, mime: file.type };
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  return blob ? { blob, mime: "image/jpeg" } : { blob: file, mime: file.type };
}

export function InspectionCapture({
  jobId,
  inspectionId,
  status: statusProp,
  vehicleLine,
  customerName,
  initialItems,
  initialQuote,
}: {
  jobId: string;
  inspectionId: string;
  status: string;
  vehicleLine: string;
  customerName: string;
  initialItems: CaptureItem[];
  initialQuote: { id: string; status: string } | null;
}) {
  const confirm = useConfirm();
  // Status lives in state: completing keeps the tech on this page (the review
  // card appears below) instead of a server round-trip + remount.
  const [status, setStatus] = useState(statusProp);
  const [items, setItems] = useState(initialItems);
  const [quote, setQuote] = useState(initialQuote);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [rewriting, setRewriting] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [, startTransition] = useTransition();
  const [completing, setCompleting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newFinding, setNewFinding] = useState("");
  const noteTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const summaryTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const readOnly = status === "sent";
  const complete = status === "complete";

  const sections = useMemo(() => {
    const bySection = new Map<string, CaptureItem[]>();
    for (const it of items) {
      const arr = bySection.get(it.section) ?? [];
      arr.push(it);
      bySection.set(it.section, arr);
    }
    return [...bySection.entries()];
  }, [items]);

  const counts = useMemo(
    () => ({
      red: items.filter((i) => i.rag === "red").length,
      amber: items.filter((i) => i.rag === "amber").length,
      green: items.filter((i) => i.rag === "green").length,
      unchecked: items.filter((i) => i.rag === "not_checked").length,
    }),
    [items],
  );

  const advisories = useMemo(() => items.filter((i) => i.rag === "amber" || i.rag === "red"), [items]);
  const missingSummaries = advisories.some((i) => !i.customerSummary.trim());

  function patchLocal(itemId: string, patch: Partial<CaptureItem>) {
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, ...patch } : i)));
  }

  function setRag(itemId: string, rag: Rag) {
    if (readOnly) return;
    const prev = items.find((i) => i.id === itemId)?.rag;
    patchLocal(itemId, { rag });
    startTransition(async () => {
      const result = await updateInspectionItem(itemId, { rag });
      if ("error" in result) {
        patchLocal(itemId, { rag: prev });
        setError(result.error);
      }
    });
  }

  function setNote(itemId: string, note: string) {
    patchLocal(itemId, { note });
    const timers = noteTimers.current;
    clearTimeout(timers.get(itemId));
    timers.set(
      itemId,
      setTimeout(() => {
        startTransition(async () => {
          const result = await updateInspectionItem(itemId, { note });
          if ("error" in result) setError(result.error);
        });
      }, 800),
    );
  }

  async function addPhoto(itemId: string, file: File) {
    setBusyItem(itemId);
    setError(null);
    try {
      const { blob, mime } = await resizePhoto(file);
      const prep = await prepareInspectionPhoto(itemId, { mime, sizeBytes: blob.size });
      if ("error" in prep) throw new Error(prep.error);
      const put = await fetch(prep.url, { method: "PUT", body: blob, headers: { "content-type": mime } });
      if (!put.ok) throw new Error("Upload failed — check your connection and try again.");
      const attach = await attachInspectionMedia(itemId, { path: prep.path, mime, sizeBytes: blob.size });
      if ("error" in attach) throw new Error(attach.error);
      const objectUrl = URL.createObjectURL(blob);
      setItems((prev) =>
        prev.map((i) =>
          i.id === itemId ? { ...i, media: [...i.media, { id: attach.mediaId, url: objectUrl, path: prep.path }] } : i,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Photo upload failed.");
    } finally {
      setBusyItem(null);
    }
  }

  function removePhoto(itemId: string, mediaId: string) {
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, media: i.media.filter((m) => m.id !== mediaId) } : i)));
    startTransition(async () => {
      const result = await removeInspectionMedia(mediaId);
      if ("error" in result) setError(result.error);
    });
  }

  async function handleSweep() {
    setError(null);
    const result = await sweepRemainingGreen(inspectionId);
    if ("error" in result) return setError(result.error);
    setItems((prev) => prev.map((i) => (i.rag === "not_checked" ? { ...i, rag: "green" } : i)));
  }

  async function handleComplete() {
    setError(null);
    if (counts.unchecked > 0) {
      const ok = await confirm({
        title: `Mark ${counts.unchecked} unchecked item${counts.unchecked === 1 ? "" : "s"} as OK?`,
        description: "Everything you haven't graded will be recorded as checked and OK.",
        confirmLabel: "Mark OK & complete",
      });
      if (!ok) return;
      await handleSweep();
    }
    setCompleting(true);
    const result = await completeInspection(inspectionId);
    setCompleting(false);
    if ("error" in result) return setError(result.error);
    // Stay on the page: the customer-wording review appears below, with the
    // AI drafts filling in as they arrive.
    setStatus("complete");
    void handleGenerate();
  }

  // Batch AI drafts for every amber/red finding still missing a summary.
  // Server falls back to the raw notes when AI is unavailable — the flow is
  // never blocked on Claude.
  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    setNotice(null);
    const res = await generateInspectionSummaries(inspectionId);
    setGenerating(false);
    if ("error" in res) return setError(res.error);
    if (res.items.length > 0) {
      setItems((prev) =>
        prev.map((i) => {
          const p = res.items.find((x) => x.id === i.id);
          return p
            ? { ...i, customerSummary: p.customerSummary, suggestedRepair: p.suggestedRepair, suggestedPrice: p.suggestedPrice }
            : i;
        }),
      );
    }
    if (!res.aiUsed) {
      setNotice("AI is unavailable right now — summaries were taken from your notes. Give them a read before sending.");
    }
  }

  async function handleRewrite(itemId: string) {
    setRewriting(itemId);
    setError(null);
    const res = await rewriteInspectionFinding(itemId);
    setRewriting(null);
    if ("error" in res) return setError(res.error);
    patchLocal(itemId, {
      customerSummary: res.item.customerSummary,
      suggestedRepair: res.item.suggestedRepair,
      suggestedPrice: res.item.suggestedPrice,
    });
  }

  function setSummary(itemId: string, text: string) {
    patchLocal(itemId, { customerSummary: text });
    const timers = summaryTimers.current;
    clearTimeout(timers.get(itemId));
    timers.set(
      itemId,
      setTimeout(() => {
        startTransition(async () => {
          const result = await updateInspectionSummary(itemId, text);
          if ("error" in result) setError(result.error);
        });
      }, 800),
    );
  }

  async function handleAddFinding() {
    const label = newFinding.trim();
    if (!label) return;
    setError(null);
    const result = await addInspectionFinding(inspectionId, { label });
    if ("error" in result) return setError(result.error);
    setItems((prev) => [
      ...prev,
      {
        id: result.itemId,
        section: "Other findings",
        label,
        rag: "amber",
        note: "",
        customerSummary: "",
        suggestedRepair: null,
        suggestedPrice: null,
        outcome: "none",
        adhoc: true,
        media: [],
      },
    ]);
    setNewFinding("");
    setAdding(false);
  }

  function removeFinding(itemId: string) {
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    startTransition(async () => {
      const result = await removeInspectionFinding(itemId);
      if ("error" in result) setError(result.error);
    });
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div>
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">Health check</h1>
          <Link href={`/staff/jobs/${jobId}`} className="text-sm text-muted-foreground underline underline-offset-2">
            Job card →
          </Link>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          {vehicleLine}
          {customerName ? ` — ${customerName}` : ""}
        </p>
        {(complete || readOnly) && (
          <p className="mt-2 rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-ws-green">
            {readOnly ? "Report sent to the customer — read-only." : "Check complete. Review the customer wording below — grades and wording stay editable until the report is sent."}
          </p>
        )}
      </div>

      {sections.map(([section, sectionItems]) => (
        <section key={section} className="rounded-lg border">
          <h2 className="border-b px-4 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ws-text-3">
            {section}
          </h2>
          <ul>
            {sectionItems.map((item) => {
              const expanded = item.rag === "amber" || item.rag === "red";
              return (
                <li key={item.id} className="border-b px-4 py-3 last:border-b-0">
                  <div className="flex items-center justify-between gap-3">
                    <span className={`text-sm leading-snug ${item.rag === "not_checked" ? "" : "text-muted-foreground"}`}>
                      {item.label}
                      {item.adhoc && !readOnly && (
                        <button
                          type="button"
                          aria-label="Remove finding"
                          onClick={() => removeFinding(item.id)}
                          className="ml-2 inline-flex align-middle text-muted-foreground hover:text-ws-red"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </span>
                    <div className="flex shrink-0 gap-1" role="radiogroup" aria-label={`${item.label} grade`}>
                      {RAG_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          role="radio"
                          aria-checked={item.rag === opt.value}
                          disabled={readOnly}
                          onClick={() => setRag(item.id, item.rag === opt.value ? "not_checked" : opt.value)}
                          className={`min-w-[58px] rounded-md border px-2 py-2 text-xs font-semibold transition-colors ${
                            item.rag === opt.value ? opt.on : opt.off
                          } ${readOnly ? "opacity-60" : "hover:border-current/40"}`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {expanded && (
                    <div className="mt-3 flex flex-col gap-2">
                      <textarea
                        value={item.note}
                        onChange={(e) => setNote(item.id, e.target.value)}
                        placeholder="Shorthand is fine — e.g. 'osf lower arm bush split'"
                        rows={2}
                        disabled={readOnly}
                        className="w-full rounded-md border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        {item.media.map((m) => (
                          <span key={m.id} className="relative">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={m.url} alt="Finding photo" className="h-16 w-16 rounded-md border object-cover" />
                            {!readOnly && (
                              <button
                                type="button"
                                aria-label="Remove photo"
                                onClick={() => removePhoto(item.id, m.id)}
                                className="absolute -right-1.5 -top-1.5 rounded-full border bg-background p-0.5 text-muted-foreground hover:text-ws-red"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            )}
                          </span>
                        ))}
                        {!readOnly && (
                          <label
                            className={`flex h-16 w-16 cursor-pointer items-center justify-center rounded-md border border-dashed text-muted-foreground hover:text-foreground ${
                              busyItem === item.id ? "animate-pulse" : ""
                            }`}
                          >
                            <Camera className="h-5 w-5" />
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              className="hidden"
                              disabled={busyItem === item.id}
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                e.target.value = "";
                                if (f) void addPhoto(item.id, f);
                              }}
                            />
                          </label>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {!readOnly && (
        <div className="rounded-lg border border-dashed p-4">
          {adding ? (
            <div className="flex flex-col gap-2">
              <input
                autoFocus
                value={newFinding}
                onChange={(e) => setNewFinding(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddFinding()}
                placeholder="Describe the finding — e.g. 'oil leak from rocker cover'"
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={handleAddFinding}>Add finding</Button>
                <Button size="sm" variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex w-full items-center justify-center gap-2 py-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-4 w-4" /> Add a finding outside the checklist
            </button>
          )}
        </div>
      )}

      {error && <p className="text-sm text-ws-red">{error}</p>}
      {notice && <p className="text-sm text-ws-amber">{notice}</p>}

      {/* Action card at the end of the checklist — the tech finishes at the
          bottom anyway, and the staff shell's mobile tab bar owns the fixed
          viewport bottom, so an in-flow card beats a fixed footer here. */}
      <div className="rounded-lg border px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs tabular-nums text-muted-foreground">
            <span className="text-ws-red font-semibold">{counts.red} red</span>
            {" · "}
            <span className="text-ws-amber font-semibold">{counts.amber} amber</span>
            {" · "}
            <span className="text-ws-green font-semibold">{counts.green} green</span>
            {counts.unchecked > 0 && <> · {counts.unchecked} unchecked</>}
          </p>
          {!readOnly && (
            <div className="flex gap-2">
              {counts.unchecked > 0 && (
                <Button variant="outline" size="sm" onClick={handleSweep}>
                  Everything else OK
                </Button>
              )}
              {!complete && (
                <Button size="sm" onClick={handleComplete} loading={completing}>
                  Complete check
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Customer wording review (Phase 3) — appears once the check is
          complete. Claude drafts a customer-friendly summary per amber/red
          finding; everything stays editable until the report is sent. */}
      {(complete || readOnly) && (
        <section className="rounded-lg border">
          <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
            <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ws-text-3">
              Customer report wording
            </h2>
            {!readOnly && missingSummaries && !generating && (
              <Button variant="outline" size="sm" onClick={handleGenerate}>
                <Sparkles className="h-3.5 w-3.5" /> Write with AI
              </Button>
            )}
          </div>
          {generating && (
            <p className="animate-pulse border-b px-4 py-3 text-sm text-muted-foreground">
              Writing customer-friendly summaries…
            </p>
          )}
          {advisories.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              No advisories — the report will show a clean bill of health.
            </p>
          ) : (
            <ul>
              {advisories.map((item) => (
                <li key={item.id} className="border-b px-4 py-3 last:border-b-0">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium leading-snug">{item.label}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {item.outcome !== "none" && (
                        <span className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground">On quote</span>
                      )}
                      <span
                        className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${
                          item.rag === "red"
                            ? "border-red-500/50 bg-red-500/25 text-ws-red"
                            : "border-amber-500/50 bg-amber-500/25 text-ws-amber"
                        }`}
                      >
                        {item.rag === "red" ? "Urgent" : "Advise"}
                      </span>
                    </span>
                  </div>
                  {item.note && <p className="mt-1 text-xs text-muted-foreground">Tech note: {item.note}</p>}
                  <div className="mt-2 flex flex-col gap-2">
                    <textarea
                      value={item.customerSummary}
                      onChange={(e) => setSummary(item.id, e.target.value)}
                      placeholder="Customer-friendly wording — what was found, why it matters, what you recommend"
                      rows={3}
                      disabled={readOnly || generating}
                      className="w-full rounded-md border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {item.suggestedRepair ? (
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Wrench className="h-3.5 w-3.5 shrink-0" />
                          <span>
                            {item.suggestedRepair}
                            {item.suggestedPrice !== null && (
                              <span className="tabular-nums"> · £{item.suggestedPrice.toFixed(2)}</span>
                            )}
                          </span>
                        </p>
                      ) : (
                        <span />
                      )}
                      {!readOnly && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRewrite(item.id)}
                          loading={rewriting === item.id}
                          disabled={generating || (rewriting !== null && rewriting !== item.id)}
                        >
                          <Sparkles className="h-3.5 w-3.5" /> Rewrite with AI
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Quote generation (Phase 4) — price up the advisories into a draft
          unified quote; the existing quote pipeline handles everything after. */}
      {(complete || readOnly) && (
        <InspectionQuotePanel
          inspectionId={inspectionId}
          items={items}
          quote={quote}
          readOnly={readOnly}
          onQuoted={(quoteId, itemIds) => {
            setQuote({ id: quoteId, status: "draft" });
            setItems((prev) => prev.map((i) => (itemIds.includes(i.id) ? { ...i, outcome: "quoted" } : i)));
          }}
        />
      )}

      {/* Send the customer report (Phase 5). Sending locks the check and
          flips a draft findings-quote to pending. */}
      {(complete || readOnly) && (
        <InspectionSendPanel
          inspectionId={inspectionId}
          status={status}
          items={items}
          hasQuote={!!quote && quote.status !== "cancelled"}
          onSent={() => {
            setStatus("sent");
            setQuote((prev) => (prev && prev.status === "draft" ? { ...prev, status: "pending" } : prev));
          }}
        />
      )}
    </div>
  );
}
