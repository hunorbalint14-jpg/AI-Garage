"use client";

import { useRef, useSyncExternalStore } from "react";

// Shared presentational bits for the courtesy-car loan diary. The board, the
// out-now cards and the check-out wizard all speak in plates, fuel eighths and
// status chips, so they live here rather than being duplicated per section.

const neverChanges = () => () => {};

/**
 * `Date.now()` read on the client only — null during SSR and the hydration
 * pass. Everything clock-derived here (due/overdue chips, progress fill, the
 * board window, the diary's day grouping, every formatted timestamp) differs
 * between the server's UTC render and the browser's local one, so deriving it
 * during render hydrates against different text.
 *
 * The reading is pinned rather than ticking (the design asks for no ticker),
 * but it is re-taken whenever `resetKey` changes identity. Pass the server data
 * the render depends on: a `revalidatePath` after check-out/return re-renders
 * these sections in place — it does NOT remount them — so without the reset a
 * loan created after page load would sit past a stale `now` and be filtered out
 * of the diary until a hard reload.
 */
export function useClientNow(resetKey?: unknown): number | null {
  const pinned = useRef<{ key: unknown; at: number } | null>(null);
  return useSyncExternalStore(
    neverChanges,
    () => {
      // Stable within a render pass: only a new resetKey re-reads the clock.
      if (!pinned.current || pinned.current.key !== resetKey) {
        pinned.current = { key: resetKey, at: Date.now() };
      }
      return pinned.current.at;
    },
    () => null,
  );
}

export const FUEL_LABELS = ["Empty", "1/8", "1/4", "3/8", "1/2", "5/8", "3/4", "7/8", "Full"];
/** Segmented-control glyphs for the same 0–8 eighths scale. */
export const FUEL_SHORT = ["E", "⅛", "¼", "⅜", "½", "⅝", "¾", "⅞", "F"];

export const DEFAULT_BRAND = "#6366f1";

/** Mix a hex colour toward white — the hover step for brand-filled buttons. */
export function lighten(hex: string, amount = 0.12): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const [r, g, b] = [0, 2, 4].map((i) => mix(parseInt(h.slice(i, i + 2), 16)));
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

export function fuelLabel(v: number | null): string {
  return v == null ? "—" : (FUEL_LABELS[v] ?? String(v));
}

/** "23 Jul, 14:05" — the diary's house date format. */
export function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Compact duration for status chips: <1H, 5H … 47H, then whole days. */
export function agoLabel(ms: number): string {
  const hours = Math.round(Math.abs(ms) / 36e5);
  if (hours < 1) return "<1H";
  if (hours < 48) return `${hours}H`;
  return `${Math.round(hours / 24)}D`;
}

export const INPUT_CLASS =
  "w-full rounded-lg border border-ws-border bg-ws-page px-2.5 py-[7px] text-[13px] text-ws-text outline-none transition-colors placeholder:text-ws-text-3 focus:border-[var(--brand)] disabled:opacity-50";

export const SECTION_LABEL_CLASS =
  "font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ws-text-3";

/** UK number plate. `sm` is the board size, `md` the card/wizard size. */
export function PlateChip({ reg, size = "md" }: { reg: string; size?: "sm" | "md" }) {
  return (
    <span
      className={`inline-flex flex-none items-center whitespace-nowrap rounded border border-ws-plate-border bg-ws-plate px-[7px] py-px font-mono font-bold tracking-[0.04em] text-[#111827] ${
        size === "sm" ? "text-[11px]" : "text-[11.5px]"
      }`}
    >
      {reg}
    </span>
  );
}

export type ChipTone = "amber" | "red" | "green" | "blue" | "neutral";

const CHIP_TONES: Record<ChipTone, string> = {
  amber: "bg-ws-amber-bg text-ws-amber border-ws-amber-border",
  red: "bg-ws-red-bg text-ws-red border-ws-red-border",
  green: "bg-ws-green-bg text-ws-green border-ws-green-border",
  blue: "bg-ws-blue-bg text-ws-blue border-ws-blue-border",
  neutral: "bg-ws-hover text-ws-text-2 border-ws-border",
};

export function StatusChip({
  tone,
  children,
  className = "",
}: {
  tone: ChipTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex flex-none items-center gap-1 whitespace-nowrap rounded-md border px-2 py-[3px] font-mono text-[10px] font-bold uppercase tracking-[0.08em] ${CHIP_TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Smaller evidence chip used under the out-now cards (signed / photos / share code). */
export function EvidenceChip({
  tone,
  href,
  onClick,
  pressed,
  children,
}: {
  tone: ChipTone;
  href?: string | null;
  onClick?: () => void;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  const className = `inline-flex flex-none items-center gap-1 whitespace-nowrap rounded-md border px-[7px] py-[2px] font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] ${CHIP_TONES[tone]}`;
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={pressed} className={`${className} hover:brightness-125`}>
        {children}
      </button>
    );
  }
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={`${className} hover:brightness-125`}>
        {children}
      </a>
    );
  }
  return <span className={className}>{children}</span>;
}

/**
 * 0–8 eighths as a segmented control. Replaces the old <select> so staff can
 * record fuel in one tap on a tablet at the handover desk.
 */
export function FuelChipPicker({
  value,
  onChange,
  brandColor,
  onBrand,
  size = "sm",
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  brandColor: string;
  onBrand: string;
  size?: "sm" | "md";
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-[3px]">
      {FUEL_SHORT.map((label, i) => {
        const selected = i === value;
        return (
          <button
            key={label}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            aria-label={FUEL_LABELS[i]}
            onClick={() => onChange(i)}
            className={`rounded border font-mono font-semibold disabled:opacity-50 ${
              size === "sm" ? "px-[7px] py-[3px] text-[10.5px]" : "px-[11px] py-[5px] text-[11.5px]"
            } ${selected ? "" : "border-ws-border bg-ws-page text-ws-text-2 hover:border-ws-text-3"}`}
            style={
              selected
                ? { background: brandColor, borderColor: brandColor, color: onBrand }
                : undefined
            }
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
