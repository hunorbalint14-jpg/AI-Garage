"use client";

import { useState, useTransition } from "react";
import { AigSpinner } from "@/components/ui/aig-spinner";
import Link from "next/link";
import { runCustomerDiagnostic } from "./diagnostic-actions";
import type { DiagnosisResult } from "@/lib/ai-diagnostic";

type Vehicle = { id: string; registration: string; make: string | null; model: string | null };

type Props = {
  vehicles: Vehicle[];
  orgColor: string;
};

const URGENCY_STYLE = {
  urgent: "bg-red-500/20 text-red-400 border-red-500/30",
  soon: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  monitor: "bg-green-500/20 text-green-400 border-green-500/30",
};

const URGENCY_LABEL = {
  urgent: "⚠️ Urgent — do not drive",
  soon: "Soon — book within 2 weeks",
  monitor: "Monitor — mention at next service",
};

const PROB_STYLE = {
  likely: "text-white font-semibold",
  possible: "text-gray-300",
  unlikely: "text-gray-500",
};

export function DiagnosticPanel({ vehicles, orgColor }: Props) {
  const [symptom, setSymptom] = useState("");
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? "");
  const [result, setResult] = useState<DiagnosisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleDiagnose() {
    if (!symptom.trim()) return;
    setError(null);
    setResult(null);
    const vehicle = vehicles.find((v) => v.id === vehicleId);
    const vehicleDesc = vehicle ? `${[vehicle.make, vehicle.registration].filter(Boolean).join(" ")}` : undefined;
    startTransition(async () => {
      const res = await runCustomerDiagnostic(symptom.trim(), vehicleDesc);
      if ("error" in res) setError(res.error);
      else setResult(res);
    });
  }

  const bookingUrl = `/dashboard/book${vehicleId ? `?vehicle=${vehicleId}` : ""}`;

  return (
    <section>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-2">
        🔍 Diagnose a problem
      </h2>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-sm flex flex-col gap-4">
        {vehicles.length > 1 && (
          <select
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            disabled={pending}
            className="w-full rounded-xl border border-white/15 bg-[#0d1525] px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30 disabled:opacity-50 [&>option]:bg-[#0d1525] [&>option]:text-white"
          >
            <option value="">— No specific vehicle —</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.registration}{v.make ? ` — ${v.make}` : ""}
              </option>
            ))}
          </select>
        )}

        <textarea
          className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-white/30 resize-none disabled:opacity-50"
          rows={3}
          placeholder="Describe the problem… e.g. 'grinding noise when braking at low speed', 'engine warning light came on', 'car pulls to the left'"
          value={symptom}
          onChange={(e) => setSymptom(e.target.value)}
          disabled={pending}
        />

        <button
          type="button"
          onClick={handleDiagnose}
          disabled={pending || !symptom.trim()}
          className="inline-flex items-center justify-center gap-2 self-start rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{ backgroundColor: orgColor }}
        >
          {pending && <AigSpinner />}
          Get AI diagnosis
        </button>

        {error && <p className="text-sm text-red-400">{error}</p>}

        {result && (
          <div className="flex flex-col gap-4 border-t border-white/10 pt-4">
            {/* Urgency */}
            <div className={`rounded-xl border px-4 py-3 ${URGENCY_STYLE[result.urgency]}`}>
              <p className="text-sm font-semibold">{URGENCY_LABEL[result.urgency]}</p>
              <p className="text-xs mt-1 opacity-80">{result.urgencyNote}</p>
            </div>

            {/* Likely causes */}
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Likely causes</p>
              <ul className="flex flex-col gap-1.5">
                {result.likelyCauses.map((c, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="text-gray-600 mt-0.5 shrink-0">
                      {c.probability === "likely" ? "●" : c.probability === "possible" ? "◐" : "○"}
                    </span>
                    <span className={PROB_STYLE[c.probability]}>{c.cause}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Cost + action */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-white/5 p-3">
                <p className="text-xs text-gray-500 mb-1">Estimated cost</p>
                <p className="font-semibold text-white">{result.estimatedCost}</p>
              </div>
              <div className="rounded-xl bg-white/5 p-3">
                <p className="text-xs text-gray-500 mb-1">Recommended</p>
                <p className="text-gray-300 text-xs leading-relaxed">{result.recommendedAction}</p>
              </div>
            </div>

            {/* Book CTA */}
            <Link
              href={bookingUrl}
              className="flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: orgColor }}
            >
              Book an appointment →
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
