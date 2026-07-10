"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PenLine, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authorisedTotal, type AuthItemSnapshot } from "@/lib/work-auth-shared";
import { captureCounterSignature } from "./auth-actions";

// Counter-signature sheet (#503 PR 2). Full-screen on the workshop tablet:
// itemised estimate → org T&Cs → canvas signature (pointer events, so
// finger/stylus/mouse all work). Exports a small PNG (canvas is capped at
// 600px wide) through the server action body.

function formatGBP(n: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

export type ExistingAuth = {
  id: string;
  total: number;
  signedName: string | null;
  authorisedAt: string | null;
} | null;

export function AuthorisePanel({
  jobId,
  items,
  terms,
  customerName,
  existing,
}: {
  jobId: string;
  items: AuthItemSnapshot[];
  terms: string | null;
  customerName: string | null;
  existing: ExistingAuth;
}) {
  const [open, setOpen] = useState(false);
  const [signerName, setSignerName] = useState(customerName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [auth, setAuth] = useState(existing);
  const [hasInk, setHasInk] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  const total = authorisedTotal(items);

  // Plain 2D-canvas signature pad. Pointer events unify mouse/touch/stylus;
  // touch-action:none stops the tablet scrolling mid-signature.
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827";

    const pos = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height };
    };
    const down = (e: PointerEvent) => {
      drawing.current = true;
      canvas.setPointerCapture(e.pointerId);
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    };
    const move = (e: PointerEvent) => {
      if (!drawing.current) return;
      const p = pos(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      setHasInk(true);
    };
    const up = () => {
      drawing.current = false;
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointerleave", up);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointerleave", up);
    };
  }, [open]);

  function clearCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
  }

  async function handleSave() {
    const canvas = canvasRef.current;
    if (!canvas || !hasInk) return setError("Please sign in the box first.");
    setBusy(true);
    setError(null);
    const res = await captureCounterSignature(jobId, {
      signatureDataUrl: canvas.toDataURL("image/png"),
      signerName,
    });
    setBusy(false);
    if ("error" in res) return setError(res.error);
    setAuth({ id: res.authId, total: res.total, signedName: signerName || customerName, authorisedAt: new Date().toISOString() });
    setOpen(false);
    clearCanvas();
  }

  return (
    <section className="rounded-lg border p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ShieldCheck className={`h-5 w-5 ${auth ? "text-ws-green" : "text-muted-foreground"}`} />
          <div>
            <h2 className="text-sm font-semibold">Work authorisation</h2>
            {auth ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                <span className="font-semibold text-ws-green">Authorised {formatGBP(auth.total)}</span>
                {auth.signedName && <> · {auth.signedName}</>}
                {auth.authorisedAt && (
                  <>
                    {" · signed "}
                    {new Date(auth.authorisedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </>
                )}
                {" · "}
                <Link href={`/staff/authorisations/${auth.id}`} className="underline underline-offset-2">
                  View record →
                </Link>
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Not authorised — take a signature at the counter before starting work.
              </p>
            )}
          </div>
        </div>
        <Button variant={auth ? "outline" : "default"} size="sm" onClick={() => setOpen(true)} disabled={items.length === 0}>
          <PenLine className="h-3.5 w-3.5" /> {auth ? "Re-authorise" : "Authorise work"}
        </Button>
      </div>
      {items.length === 0 && !auth && (
        <p className="text-xs text-muted-foreground">Add the estimate items first — authorisation covers an itemised estimate.</p>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4">
          <div className="my-4 w-full max-w-xl rounded-xl bg-background p-5 shadow-xl flex flex-col gap-4">
            <div>
              <h3 className="text-lg font-semibold">Authorise this work</h3>
              <p className="text-sm text-muted-foreground">
                Please check the items below, read the terms, and sign to authorise.
              </p>
            </div>

            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i} className="border-b last:border-b-0">
                      <td className="px-3 py-2">
                        {it.description}
                        <span className="ml-1.5 text-xs text-muted-foreground capitalize">· {it.type}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                        {it.quantity} × {formatGBP(it.unit_price)}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-muted/40 font-semibold">
                    <td className="px-3 py-2">Total (inc. VAT)</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatGBP(total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {terms && (
              <div className="max-h-36 overflow-y-auto rounded-lg border bg-muted/20 p-3 text-xs whitespace-pre-wrap text-muted-foreground">
                {terms}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted-foreground">Name of person authorising</label>
              <input
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder="Customer name"
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground">Signature</label>
                <button type="button" onClick={clearCanvas} className="text-xs text-muted-foreground underline underline-offset-2">
                  Clear
                </button>
              </div>
              <canvas
                ref={canvasRef}
                width={600}
                height={200}
                className="w-full rounded-lg border bg-white"
                style={{ touchAction: "none" }}
              />
            </div>

            {error && <p className="text-sm text-ws-red">{error}</p>}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={handleSave} loading={busy} disabled={!hasInk}>
                Save authorisation — {formatGBP(total)}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
