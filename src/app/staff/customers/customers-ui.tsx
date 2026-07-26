import {
  dueUrgency,
  healthColor,
  type AiSignal,
  type InsightAction,
  type SegmentKey,
  type Urgency,
  SIGNAL_LABEL,
  SIGNAL_TONE,
} from "@/lib/customer-insights";

// Presentational vocabulary for the Customers command deck. Plain module (no
// "use client") so the server list/record pages and the client deck/panel all
// render identical markup from the same source.

/**
 * One scored customer, ready to render. Every clock-derived string is formatted
 * on the server against a single `now`, so the client never re-derives a date
 * and there is nothing for hydration to disagree about.
 */
export type DeckRow = {
  id: string;
  name: string | null;
  contact: string;
  isDemo: boolean;
  branchName: string | null;
  plates: string[];
  health: number;
  segments: SegmentKey[];
  nextDue: string;
  nextDueUrgency: Urgency;
  lastIn: string;
  balance: number;
  lifetimeValue: number;
  visitCount: number;
  signal: AiSignal;
  brief: string;
  actions: InsightAction[];
  vehicles: { registration: string; model: string; due: string; urgency: Urgency }[];
};

export const MONO_LABEL_CLASS =
  "font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ws-text-3";

export const MONO_CAPTION_CLASS = "font-mono text-[10px] tracking-[0.12em] text-ws-text-3";

/** Card shell: the deck's 10px surfaces (list) — sections use 12px. */
export const CARD_CLASS = "rounded-[10px] border border-ws-border bg-ws-card";
export const SECTION_CLASS = "rounded-[12px] border border-ws-border bg-ws-card";

export const CONTROL_CLASS =
  "h-[38px] rounded-[10px] border border-ws-border bg-ws-rail text-[13px] text-ws-text outline-none transition-colors focus:border-ws-text-3";

export function initialsOf(name: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export const fmtGBP = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

/** Whole-pound form for the KPI cluster — "£2,340", not "£2,340.00". */
export const fmtGBP0 = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(n);

/** Initials disc, ringed in the customer's health colour. */
export function HealthAvatar({
  name,
  health,
  size = 30,
}: {
  name: string | null;
  health: number;
  size?: 30 | 36 | 56;
}) {
  const border = size === 56 ? 2.5 : 2;
  const fontSize = size === 56 ? 17 : size === 36 ? 12 : 10;
  return (
    <span
      aria-hidden
      className="grid flex-none place-items-center rounded-full bg-ws-hover font-mono font-bold text-[#c8ccd2]"
      style={{
        width: size,
        height: size,
        border: `${border}px solid ${healthColor(health)}`,
        fontSize,
      }}
    >
      {initialsOf(name)}
    </span>
  );
}

/**
 * Health as a stroked arc. `size` is the rendered box; the geometry is derived
 * from `r` so the 24px list ring and the 64px hero ring share one code path.
 */
export function HealthRing({
  health,
  size,
  r,
  stroke,
  children,
}: {
  health: number;
  size: number;
  r: number;
  stroke: number;
  children?: React.ReactNode;
}) {
  const box = (r + stroke) * 2;
  const c = 2 * Math.PI * r;
  const arc = (Math.max(0, Math.min(100, health)) * c) / 100;
  const centre = box / 2;
  return (
    <span className="relative inline-grid flex-none place-items-center">
      <svg width={size} height={size} viewBox={`0 0 ${box} ${box}`} role="img" aria-label={`Health ${health} out of 100`}>
        <circle cx={centre} cy={centre} r={r} fill="none" stroke="var(--color-ws-border)" strokeWidth={stroke} />
        <circle
          cx={centre}
          cy={centre}
          r={r}
          fill="none"
          stroke={healthColor(health)}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${arc.toFixed(2)} ${c.toFixed(2)}`}
          transform={`rotate(-90 ${centre} ${centre})`}
        />
      </svg>
      {children && <span className="absolute text-center">{children}</span>}
    </span>
  );
}

/** UK number plate. `sm` for table cells, `md` for the record's vehicle cards. */
export function PlateChip({ reg, size = "sm" }: { reg: string; size?: "sm" | "md" }) {
  return (
    <span
      className={`inline-flex flex-none items-center whitespace-nowrap border border-ws-plate-border bg-ws-plate font-mono font-bold text-ws-rail ${
        size === "md" ? "rounded-[4px] px-2 py-[2px] text-[13px]" : "rounded-[3px] px-[6px] py-px text-[11px]"
      }`}
    >
      {reg}
    </span>
  );
}

const TONE_CLASS: Record<"green" | "red" | "amber" | "purple" | "none", string> = {
  green: "border-ws-green-border bg-ws-green-bg text-ws-green",
  red: "border-ws-red-border bg-ws-red-bg text-ws-red",
  amber: "border-ws-amber-border bg-ws-amber-bg text-ws-amber",
  purple: "border-ws-purple-border bg-ws-purple-bg text-ws-purple",
  none: "border-ws-border text-ws-text-3",
};

const URGENCY_TONE: Record<Urgency, "green" | "red" | "amber" | "none"> = {
  red: "red",
  amber: "amber",
  green: "green",
  none: "none",
};

/** The AI SIGNAL cell — a chip, or a plain em dash when there's nothing to say. */
export function SignalChip({ signal }: { signal: AiSignal }) {
  if (!signal) return <span className="text-[11px] text-ws-text-3">—</span>;
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-[6px] border px-2 py-[2px] text-[11px] font-semibold ${TONE_CLASS[SIGNAL_TONE[signal]]}`}
    >
      {SIGNAL_LABEL[signal]}
    </span>
  );
}

/** "MOT · 17D" / "SERVICE · OVERDUE 12D" pill on the record's vehicle cards. */
export function DuePill({ label, days }: { label: string; days: number | null }) {
  const tone = URGENCY_TONE[dueUrgency(days)];
  const text =
    days === null ? "—" : days < 0 ? `OVERDUE ${-days}D` : `${days}D`;
  return (
    <span
      className={`inline-flex items-center rounded-[6px] border px-2 py-[3px] font-mono text-[10.5px] font-semibold tracking-[0.04em] ${TONE_CLASS[tone]}`}
    >
      {label} · {text}
    </span>
  );
}

/** NEXT DUE cell: urgency carries in colour AND weight, never colour alone. */
export const DUE_TEXT_CLASS: Record<Urgency, string> = {
  red: "text-ws-red font-semibold",
  amber: "text-ws-amber font-medium",
  green: "text-ws-text-2",
  none: "text-ws-text-3",
};

/** Same bands, colour only — the mono due labels beside a plate. */
export const URGENCY_TEXT_CLASS: Record<Urgency, string> = {
  red: "text-ws-red",
  amber: "text-ws-amber",
  green: "text-ws-green",
  none: "text-ws-text-3",
};

/** Small mono label with the deck's `// ` prefix convention. */
export function SectionLabel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <h2 className={`${MONO_LABEL_CLASS} ${className}`}>{`// ${children}`}</h2>;
}
