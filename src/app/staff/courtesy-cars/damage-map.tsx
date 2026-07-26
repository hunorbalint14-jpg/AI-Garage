"use client";

import { useState } from "react";
import { X } from "lucide-react";
import {
  DAMAGE_CODES,
  DAMAGE_CODE_LABELS,
  DAMAGE_MAX_MARKERS,
  DAMAGE_SIZES,
  DAMAGE_SIZE_LABELS,
  DAMAGE_VIEWS,
  DAMAGE_VIEW_LABELS,
  FAIR_WEAR_HINT,
  nextMarkerId,
  type DamageCode,
  type DamageMarker,
  type DamageSize,
  type DamageView,
} from "@/lib/courtesy-damage";

// The condition diagram every UK hire desk marks up at hand-over. Four
// elevations plus the wheels — the panels and the rims are where nearly every
// dispute lands. Each view is drawn in a 200x120 box and markers are stored as
// percentages, so the SVG can scale without touching the data.

const VIEW_BOX = { w: 200, h: 120 };

const OUTLINE = "var(--ws-damage-outline, #5a6170)";

/** Simplified car outlines — recognisable at a glance, no wasted detail. */
function ViewArt({ view }: { view: DamageView }) {
  const stroke = { stroke: OUTLINE, strokeWidth: 1.6, fill: "none", strokeLinejoin: "round" as const };
  switch (view) {
    case "front":
      return (
        <g {...stroke}>
          <path d="M40 82 L40 56 Q40 44 52 40 L64 30 Q68 27 74 27 L126 27 Q132 27 136 30 L148 40 Q160 44 160 56 L160 82 Q160 88 154 88 L46 88 Q40 88 40 82 Z" />
          <path d="M62 40 L70 31 Q72 29 76 29 L124 29 Q128 29 130 31 L138 40 Z" />
          <rect x="52" y="62" width="20" height="9" rx="3" />
          <rect x="128" y="62" width="20" height="9" rx="3" />
          <path d="M62 82 L138 82" />
          <path d="M40 60 L34 60 M160 60 L166 60" />
        </g>
      );
    case "rear":
      return (
        <g {...stroke}>
          <path d="M40 84 L40 58 Q40 46 52 42 L62 30 Q66 27 72 27 L128 27 Q134 27 138 30 L148 42 Q160 46 160 58 L160 84 Q160 90 154 90 L46 90 Q40 90 40 84 Z" />
          <path d="M60 42 L68 31 Q70 29 74 29 L126 29 Q130 29 132 31 L140 42 Z" />
          <rect x="50" y="60" width="22" height="10" rx="3" />
          <rect x="128" y="60" width="22" height="10" rx="3" />
          <rect x="86" y="74" width="28" height="9" rx="2" />
        </g>
      );
    case "offside":
    case "nearside": {
      // Nearside is the same silhouette mirrored, so the marker a tech taps
      // always lands on the panel they are looking at.
      const flip = view === "nearside";
      return (
        <g {...stroke} transform={flip ? `translate(${VIEW_BOX.w} 0) scale(-1 1)` : undefined}>
          <path d="M18 78 L22 58 Q24 50 34 48 L58 32 Q64 28 74 28 L128 28 Q140 28 148 34 L172 50 Q182 53 182 62 L182 78 Q182 84 176 84 L24 84 Q18 84 18 78 Z" />
          <path d="M60 46 L74 34 Q78 32 84 32 L102 32 L102 46 Z" />
          <path d="M108 32 L128 32 Q136 32 142 36 L156 46 L108 46 Z" />
          <path d="M102 46 L102 84 M108 46 L108 84" />
          <circle cx="58" cy="84" r="13" />
          <circle cx="146" cy="84" r="13" />
          <path d="M96 60 L92 60 M114 60 L118 60" />
        </g>
      );
    }
    case "wheels":
      return (
        <g {...stroke}>
          {[
            { cx: 56, cy: 40, label: "NSF" },
            { cx: 144, cy: 40, label: "OSF" },
            { cx: 56, cy: 88, label: "NSR" },
            { cx: 144, cy: 88, label: "OSR" },
          ].map((w) => (
            <g key={w.label}>
              <circle cx={w.cx} cy={w.cy} r="20" />
              <circle cx={w.cx} cy={w.cy} r="9" />
              <text
                x={w.cx}
                y={w.cy + 33}
                textAnchor="middle"
                fill={OUTLINE}
                stroke="none"
                fontSize="9"
                fontFamily="var(--font-geist-mono, monospace)"
              >
                {w.label}
              </text>
            </g>
          ))}
        </g>
      );
  }
}

const CODE_TONE: Record<DamageCode, string> = {
  S: "#ffb020",
  D: "#ff5b5b",
  C: "#7ec8ff",
  CR: "#ff5b5b",
  SF: "#ffb020",
  M: "#c084fc",
  R: "#b98b4a",
};

export function DamageMap({
  markers,
  onChange,
  brandColor,
  onBrand,
  readOnly,
  disabled,
  /** Markers carried over from check-out — shown dimmed and not removable. */
  baseline = [],
}: {
  markers: DamageMarker[];
  onChange?: (markers: DamageMarker[]) => void;
  brandColor: string;
  onBrand: string;
  readOnly?: boolean;
  disabled?: boolean;
  baseline?: DamageMarker[];
}) {
  const [view, setView] = useState<DamageView>("front");
  const [code, setCode] = useState<DamageCode>("S");
  const [size, setSize] = useState<DamageSize>("S");
  const [selected, setSelected] = useState<string | null>(null);

  const baselineIds = new Set(baseline.map((m) => m.id));
  const viewMarkers = markers.filter((m) => m.view === view);
  const full = markers.length >= DAMAGE_MAX_MARKERS;

  function place(e: React.MouseEvent<SVGSVGElement>) {
    if (readOnly || disabled || !onChange || full) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    const marker: DamageMarker = {
      id: nextMarkerId([...markers.map((m) => m.id), ...baseline.map((m) => m.id)]),
      view,
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      code,
      size,
      note: null,
    };
    onChange([...markers, marker]);
    setSelected(marker.id);
  }

  function removeMarker(id: string) {
    if (readOnly || disabled || !onChange) return;
    onChange(markers.filter((m) => m.id !== id));
    if (selected === id) setSelected(null);
  }

  function setNote(id: string, note: string) {
    if (!onChange) return;
    onChange(markers.map((m) => (m.id === id ? { ...m, note: note.trim() || null } : m)));
  }

  const selectedMarker = markers.find((m) => m.id === selected) ?? null;

  return (
    <div
      className={`flex flex-col gap-2 ${disabled ? "pointer-events-none opacity-50" : ""}`}
      style={{ "--brand": brandColor } as React.CSSProperties}
    >
      {/* View tabs */}
      <div className="flex flex-wrap gap-1">
        {DAMAGE_VIEWS.map((v) => {
          const count = markers.filter((m) => m.view === v).length;
          const active = v === view;
          return (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-[6px] border px-2 py-1 text-[11px] font-medium transition-colors ${
                active ? "" : "border-ws-border bg-ws-page text-ws-text-2 hover:text-ws-text"
              }`}
              style={active ? { background: brandColor, borderColor: brandColor, color: onBrand } : undefined}
            >
              {DAMAGE_VIEW_LABELS[v]}
              {count > 0 && <span className="ml-1 font-mono text-[10px]">({count})</span>}
            </button>
          );
        })}
      </div>

      {/* Diagram */}
      <svg
        viewBox={`0 0 ${VIEW_BOX.w} ${VIEW_BOX.h}`}
        onClick={place}
        role="img"
        aria-label={`${DAMAGE_VIEW_LABELS[view]} damage diagram`}
        className={`w-full rounded-[8px] border border-ws-border bg-ws-page ${
          readOnly || full ? "" : "cursor-crosshair"
        }`}
      >
        <ViewArt view={view} />
        {viewMarkers.map((m, i) => {
          const carried = baselineIds.has(m.id);
          return (
            <g
              key={m.id}
              opacity={carried ? 0.5 : 1}
              onClick={(e) => {
                e.stopPropagation();
                setSelected(m.id === selected ? null : m.id);
              }}
              className="cursor-pointer"
            >
              <circle
                cx={(m.x / 100) * VIEW_BOX.w}
                cy={(m.y / 100) * VIEW_BOX.h}
                r={m.size === "L" ? 8 : m.size === "M" ? 6.5 : 5}
                fill={`${CODE_TONE[m.code]}33`}
                stroke={CODE_TONE[m.code]}
                strokeWidth={m.id === selected ? 2 : 1.3}
              />
              <text
                x={(m.x / 100) * VIEW_BOX.w}
                y={(m.y / 100) * VIEW_BOX.h + 3}
                textAnchor="middle"
                fontSize="7"
                fontWeight="700"
                fill={CODE_TONE[m.code]}
                fontFamily="var(--font-geist-mono, monospace)"
                style={{ pointerEvents: "none" }}
              >
                {m.code}
              </text>
              <title>{`${i + 1}. ${DAMAGE_CODE_LABELS[m.code]} · ${DAMAGE_SIZE_LABELS[m.size]}${
                m.note ? ` · ${m.note}` : ""
              }${carried ? " (recorded at check-out)" : ""}`}</title>
            </g>
          );
        })}
      </svg>

      {!readOnly && (
        <>
          {/* Marker type + size pickers */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <div className="flex flex-wrap gap-1">
              {DAMAGE_CODES.map((c) => {
                const active = c === code;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCode(c)}
                    title={DAMAGE_CODE_LABELS[c]}
                    className={`rounded-[4px] border px-2 py-[3px] font-mono text-[10.5px] font-semibold transition-colors ${
                      active ? "" : "border-ws-border bg-ws-page text-ws-text-2 hover:text-ws-text"
                    }`}
                    style={
                      active
                        ? { background: `${CODE_TONE[c]}22`, borderColor: CODE_TONE[c], color: CODE_TONE[c] }
                        : undefined
                    }
                  >
                    {c}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-1">
              {DAMAGE_SIZES.map((s) => {
                const active = s === size;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSize(s)}
                    title={DAMAGE_SIZE_LABELS[s]}
                    className={`rounded-[4px] border px-2 py-[3px] font-mono text-[10.5px] font-semibold transition-colors ${
                      active ? "" : "border-ws-border bg-ws-page text-ws-text-2 hover:text-ws-text"
                    }`}
                    style={active ? { background: brandColor, borderColor: brandColor, color: onBrand } : undefined}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
            <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-ws-text-3">
              {DAMAGE_CODE_LABELS[code]} · {DAMAGE_SIZE_LABELS[size]}
            </span>
          </div>

          <p className="text-[11px] text-ws-text-3">
            {full
              ? `Marker limit reached (${DAMAGE_MAX_MARKERS}). Remove one to add another.`
              : "Tap the diagram where the damage is. Tap a marker to add a note or remove it."}
          </p>
          <p className="text-[11px] text-ws-text-3">{FAIR_WEAR_HINT}</p>
        </>
      )}

      {/* Selected marker editor */}
      {selectedMarker && (
        <div className="flex items-center gap-2 rounded-[8px] border border-ws-border bg-ws-page px-2.5 py-2">
          <span
            className="font-mono text-[10.5px] font-bold"
            style={{ color: CODE_TONE[selectedMarker.code] }}
          >
            {selectedMarker.code}
          </span>
          <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-ws-text-3">
            {DAMAGE_VIEW_LABELS[selectedMarker.view]}
          </span>
          {readOnly || baselineIds.has(selectedMarker.id) ? (
            <span className="flex-1 truncate text-[12px] text-ws-text-2">
              {selectedMarker.note ?? DAMAGE_SIZE_LABELS[selectedMarker.size]}
            </span>
          ) : (
            <>
              <input
                value={selectedMarker.note ?? ""}
                onChange={(e) => setNote(selectedMarker.id, e.target.value)}
                placeholder="Note (optional) — e.g. kerbed alloy"
                maxLength={120}
                className="min-w-0 flex-1 rounded-[6px] border border-ws-border bg-ws-card px-2 py-1 text-[12px] text-ws-text outline-none focus:border-[var(--brand)]"
              />
              <button
                type="button"
                onClick={() => removeMarker(selectedMarker.id)}
                aria-label="Remove marker"
                className="rounded-[6px] p-1 text-ws-text-3 transition-colors hover:bg-ws-hover hover:text-ws-red"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
