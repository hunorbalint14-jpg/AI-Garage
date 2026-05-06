"use client";

import { useState, useTransition } from "react";
import { runStaffDiagnostic } from "./diagnostic-action";
import type { DiagnosisResult } from "@/lib/ai-diagnostic";

type Vehicle = { id: string; registration: string; make: string | null; model: string | null };

const URGENCY_STYLE = {
  urgent: "border-red-200 bg-red-50 text-red-800",
  soon: "border-amber-200 bg-amber-50 text-amber-800",
  monitor: "border-green-200 bg-green-50 text-green-800",
};

const URGENCY_LABEL = {
  urgent: "⚠️ Urgent — unsafe to drive",
  soon: "Soon — book within 2 weeks",
  monitor: "Monitor — next service fine",
};

export function StaffDiagnostic({ vehicles }: { vehicles: Vehicle[] }) {
  const [open, setOpen] = useState(false);
  const [symptom, setSymptom] = useState("");
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? "");
  const [result, setResult] = useState<DiagnosisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleDiagnose() {
    if (!symptom.trim()) return;
    setError(null);
    setResult(null);
    const v = vehicles.find((v) => v.id === vehicleId);
    const vDesc = v ? `${[v.make, v.registration].filter(Boolean).join(" ")}` : undefined;
    startTransition(async () => {
      const res = await runStaffDiagnostic(symptom.trim(), vDesc);
      if ("error" in res) setError(res.error);
      else setResult(res);
    });
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs underline text-muted-foreground hover:text-foreground">
        + AI diagnostic
      </button>
    );
  }

  return (
    <section className="rounded-lg border p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">AI Diagnostic</h2>
        <button type="button" onClick={() => { setOpen(false); setResult(null); setSymptom(""); }} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
      </div>

      {vehicles.length > 0 && (
        <select
          value={vehicleId}
          onChange={(e) => setVehicleId(e.target.value)}
          disabled={pending}
          className="rounded-md border border-black/20 bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        >
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>{v.registration}{v.make ? ` — ${v.make}` : ""}</option>
          ))}
        </select>
      )}

      <textarea
        className="w-full rounded-md border border-black/20 bg-transparent px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        rows={2}
        placeholder="Describe symptom e.g. 'grinding when braking', 'engine warning light'"
        value={symptom}
        onChange={(e) => setSymptom(e.target.value)}
        disabled={pending}
      />

      <button
        type="button"
        onClick={handleDiagnose}
        disabled={pending || !symptom.trim()}
        className="self-start rounded-lg border border-transparent bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
      >
        {pending ? "Diagnosing…" : "Run diagnosis"}
      </button>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {result && (
        <div className="flex flex-col gap-3 border-t pt-3">
          <div className={`rounded-lg border px-3 py-2 text-sm ${URGENCY_STYLE[result.urgency]}`}>
            <p className="font-semibold">{URGENCY_LABEL[result.urgency]}</p>
            <p className="text-xs mt-0.5 opacity-80">{result.urgencyNote}</p>
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-1.5 uppercase tracking-wide">Likely causes</p>
            <ul className="flex flex-col gap-1 text-sm">
              {result.likelyCauses.map((c, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-muted-foreground shrink-0">{c.probability === "likely" ? "●" : c.probability === "possible" ? "◐" : "○"}</span>
                  <span className={c.probability === "likely" ? "font-medium" : "text-muted-foreground"}>{c.cause}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-muted/40 p-2.5">
              <p className="text-xs text-muted-foreground mb-1">Est. cost</p>
              <p className="font-semibold">{result.estimatedCost}</p>
            </div>
            <div className="rounded-lg bg-muted/40 p-2.5">
              <p className="text-xs text-muted-foreground mb-1">Action</p>
              <p className="text-xs leading-relaxed">{result.recommendedAction}</p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
