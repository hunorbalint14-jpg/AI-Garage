"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Search, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/staff/pagination";
import { DemoChip } from "@/components/staff/demo-chip";
import type { SegmentKey, SortKey } from "@/lib/customer-insights";
import {
  CARD_CLASS,
  CONTROL_CLASS,
  DUE_TEXT_CLASS,
  DeckRow,
  HealthAvatar,
  HealthRing,
  MONO_CAPTION_CLASS,
  MONO_LABEL_CLASS,
  PlateChip,
  SignalChip,
  fmtGBP,
} from "./customers-ui";
import { PreviewPanel } from "./preview-panel";

// The Customers "command deck": segments, a scored table and a preview panel,
// so the day's work can be done from one screen. Filtering, sorting and paging
// all live in the URL (the server re-queries and re-scores); only selection and
// row density are client state.

const GRID_TEMPLATE =
  "minmax(180px,1.7fr) minmax(120px,1.2fr) 80px minmax(105px,1fr) 84px 80px minmax(110px,1.1fr)";

const DENSITY_KEY = "staff:customers:density";
type Density = "comfortable" | "compact";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "attention", label: "Needs attention first" },
  { value: "recent", label: "Recently active" },
  { value: "name", label: "Name A–Z" },
  { value: "balance", label: "Highest balance" },
];

export function CustomersDeck({
  rows,
  segments,
  segmentCounts,
  activeSegment,
  sort,
  branch,
  branches,
  query,
  page,
  pageSize,
  matchCount,
  recordCount,
  scanned,
  scanTruncated,
  branchLabel,
  brandColor,
  onBrand,
  error,
}: {
  rows: DeckRow[];
  segments: { key: SegmentKey; label: string; dot: string }[];
  segmentCounts: Record<SegmentKey, number>;
  activeSegment: SegmentKey;
  sort: SortKey;
  branch: string;
  branches: { id: string; name: string }[];
  query: string;
  page: number;
  pageSize: number;
  matchCount: number;
  recordCount: number;
  scanned: number;
  scanTruncated: boolean;
  branchLabel: string;
  brandColor: string;
  onBrand: string;
  error: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [searchValue, setSearchValue] = useState(query);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [density, setDensity] = useState<Density>("comfortable");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resync the editable input when q changes via navigation (back/forward, chip click)
    setSearchValue(query);
  }, [query]);

  useEffect(() => {
    const stored = window.localStorage.getItem(DENSITY_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a stored preference can only be read after mount; SSR always renders "comfortable"
    if (stored === "compact" || stored === "comfortable") setDensity(stored);
  }, []);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const push = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      params.delete("page"); // any re-filter starts from page 1
      startTransition(() => {
        router.push(`/staff/customers${params.toString() ? `?${params.toString()}` : ""}`);
      });
    },
    [router, searchParams],
  );

  function handleSearch(value: string) {
    setSearchValue(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      push((params) => {
        if (value.trim()) params.set("q", value.trim());
        else params.delete("q");
      });
    }, 250);
  }

  function setParam(key: string, value: string, fallback: string) {
    push((params) => {
      if (value && value !== fallback) params.set(key, value);
      else params.delete(key);
    });
  }

  function chooseDensity(next: Density) {
    setDensity(next);
    window.localStorage.setItem(DENSITY_KEY, next);
  }

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);

  // Selection survives re-sorts but not a result set that no longer holds it.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- drop a selection the new server results no longer contain
    if (selectedId && !rows.some((r) => r.id === selectedId)) setSelectedId(null);
  }, [rows, selectedId]);

  const open = useCallback((id: string) => router.push(`/staff/customers/${id}`), [router]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      const typing = tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable;

      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (typing) return;
      if (event.key === "Escape") {
        setSelectedId(null);
        return;
      }
      if (rows.length === 0) return;

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedId((current) => {
          const index = current ? rows.findIndex((r) => r.id === current) : -1;
          if (index === -1) return rows[0].id;
          const next = event.key === "ArrowDown" ? Math.min(rows.length - 1, index + 1) : Math.max(0, index - 1);
          return rows[next].id;
        });
        return;
      }
      if (event.key === "Enter" && selectedId) open(selectedId);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [rows, selectedId, open]);

  const cellPadding = density === "compact" ? "6px 12px" : "11px 12px";

  const pageParams = new URLSearchParams();
  if (query) pageParams.set("q", query);
  if (activeSegment !== "all") pageParams.set("segment", activeSegment);
  if (sort !== "attention") pageParams.set("sort", sort);
  if (branch !== "all") pageParams.set("branch", branch);

  return (
    <div className="flex flex-col gap-4" style={{ "--brand": brandColor } as React.CSSProperties}>
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-baseline gap-2.5">
            <h1 className="text-2xl font-bold leading-8 tracking-[-0.6px] text-[#fafafa]">Customers</h1>
            <span className={MONO_CAPTION_CLASS}>
              {recordCount} RECORD{recordCount === 1 ? "" : "S"} · {branchLabel}
            </span>
          </div>
          <p className="mt-1 text-sm text-ws-text-2">
            Sorted, scored and segmented for you — act on the ones that matter today.
          </p>
        </div>
        <div className="flex flex-none gap-2">
          <Button
            nativeButton={false}
            variant="outline"
            render={<Link href="/staff/customers/import">Import CSV</Link>}
          />
          <Button
            nativeButton={false}
            render={
              <Link href="/staff/customers/new">
                <UserPlus className="mr-1.5 inline h-4 w-4" />
                Add customer
              </Link>
            }
          />
        </div>
      </div>

      {error && <p className="text-sm text-ws-red">Failed to load: {error}</p>}

      {/* AI segments */}
      <div className={`${CARD_CLASS} px-4 py-3`}>
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-3">
          <span className={`${MONO_LABEL_CLASS} text-ws-purple`}>{"// AI SEGMENTS"}</span>
          <span className="font-mono text-[10px] text-ws-text-3">
            {scanTruncated
              ? `SCORED THE ${scanned} MOST RECENT OF ${recordCount} RECORDS`
              : "RECALCULATED JUST NOW · DUE DATES + BALANCES + VISIT PATTERNS"}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {segments.map((s) => {
            const active = s.key === activeSegment;
            return (
              <button
                key={s.key}
                type="button"
                aria-pressed={active}
                onClick={() => setParam("segment", s.key, "all")}
                className={`inline-flex items-center gap-[7px] rounded-full border px-3 py-1.5 text-[12.5px] transition-colors ${
                  active
                    ? "font-semibold text-[#fafafa]"
                    : "border-ws-border bg-ws-page font-medium text-ws-text-2 hover:border-ws-text-3"
                }`}
                style={
                  active
                    ? { borderColor: brandColor, background: `color-mix(in srgb, ${brandColor} 14%, transparent)` }
                    : undefined
                }
              >
                <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: s.dot }} />
                {s.label}
                <span className="ml-1.5 font-mono text-[11px] opacity-75">{segmentCounts[s.key]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[260px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ws-text-3" />
          <input
            ref={searchRef}
            type="search"
            value={searchValue}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search name, reg, phone…"
            aria-label="Search customers"
            className={`${CONTROL_CLASS} w-full pl-9 pr-16 text-sm text-[#fafafa] placeholder:text-ws-text-3`}
          />
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-[4px] border border-ws-border bg-ws-card px-1.5 py-0.5 font-mono text-[10px] text-ws-text-3">
            /
          </span>
        </div>

        <select
          value={sort}
          aria-label="Sort customers"
          onChange={(e) => setParam("sort", e.target.value, "attention")}
          className={`${CONTROL_CLASS} px-3`}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        {branches.length > 0 && (
          <select
            value={branch}
            aria-label="Filter by branch"
            onChange={(e) => setParam("branch", e.target.value, "all")}
            className={`${CONTROL_CLASS} px-3`}
          >
            <option value="all">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}

        <div className="flex h-[38px] overflow-hidden rounded-[10px] border border-ws-border">
          <DensityButton
            label="Comfortable"
            active={density === "comfortable"}
            onClick={() => chooseDensity("comfortable")}
            lines={3}
          />
          <DensityButton
            label="Compact"
            active={density === "compact"}
            onClick={() => chooseDensity("compact")}
            lines={4}
          />
        </div>
      </div>

      {/* Table + preview */}
      <div
        className={`grid items-start gap-4 ${selected ? "xl:grid-cols-[minmax(0,1fr)_340px]" : "grid-cols-1"}`}
      >
        <div className="min-w-0">
          {/* Desktop / tablet: the scored grid */}
          <div className={`${CARD_CLASS} hidden overflow-x-auto sm:block`}>
            <div className="min-w-[762px]">
              <div
                className="grid bg-ws-rail px-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ws-text-3"
                style={{ gridTemplateColumns: GRID_TEMPLATE }}
              >
                <div className="px-3 py-2.5">Customer</div>
                <div className="px-3 py-2.5">Vehicles</div>
                <div className="px-3 py-2.5">Health</div>
                <div className="px-3 py-2.5">Next due</div>
                <div className="px-3 py-2.5">Last in</div>
                <div className="px-3 py-2.5 text-right">Owes</div>
                <div className="px-3 py-2.5">AI signal</div>
              </div>

              {rows.map((row) => {
                const isSelected = row.id === selectedId;
                return (
                  <div
                    key={row.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedId(row.id)}
                    onDoubleClick={() => open(row.id)}
                    onKeyDown={(e) => {
                      if (e.key === " ") {
                        e.preventDefault();
                        setSelectedId(row.id);
                      }
                    }}
                    className={`grid cursor-pointer items-center border-t border-[#22262d] px-1 transition-colors hover:bg-ws-hover ${
                      isSelected ? "bg-ws-hover" : ""
                    }`}
                    style={{
                      gridTemplateColumns: GRID_TEMPLATE,
                      boxShadow: isSelected ? `inset 2px 0 0 ${brandColor}` : undefined,
                    }}
                  >
                    <div className="min-w-0" style={{ padding: cellPadding }}>
                      <div className="flex min-w-0 items-center gap-2.5">
                        <HealthAvatar name={row.name} health={row.health} />
                        <span className="min-w-0">
                          <span className="block truncate text-[13.5px] font-semibold text-ws-text">
                            {row.name ?? "Unnamed customer"} {row.isDemo && <DemoChip />}
                          </span>
                          <span className="block truncate text-[11.5px] text-ws-text-3">{row.contact}</span>
                        </span>
                      </div>
                    </div>
                    <div className="min-w-0" style={{ padding: cellPadding }}>
                      <PlateCell plates={row.plates} />
                    </div>
                    <div className="min-w-0" style={{ padding: cellPadding }}>
                      <span className="inline-flex items-center gap-[7px]">
                        <HealthRing health={row.health} size={24} r={10} stroke={3.5} />
                        <span className="font-mono text-[12px] text-ws-text-2">{row.health}</span>
                      </span>
                    </div>
                    <div className="min-w-0" style={{ padding: cellPadding }}>
                      <span className={`whitespace-nowrap text-[12.5px] ${DUE_TEXT_CLASS[row.nextDueUrgency]}`}>
                        {row.nextDue}
                      </span>
                    </div>
                    <div className="min-w-0" style={{ padding: cellPadding }}>
                      <span className="whitespace-nowrap text-[12.5px] text-ws-text-2">{row.lastIn}</span>
                    </div>
                    <div className="min-w-0 text-right" style={{ padding: cellPadding }}>
                      <span
                        className={`text-[12.5px] tabular-nums ${row.balance > 0 ? "font-semibold text-ws-amber" : "text-ws-text-3"}`}
                      >
                        {row.balance > 0 ? fmtGBP(row.balance) : "—"}
                      </span>
                    </div>
                    <div className="min-w-0" style={{ padding: cellPadding }}>
                      <SignalChip signal={row.signal} />
                    </div>
                  </div>
                );
              })}

              {rows.length === 0 && (
                <p className="p-12 text-center font-mono text-xs text-ws-text-3">
                  {"// NO CUSTOMERS MATCH — CLEAR SEARCH OR SEGMENT"}
                </p>
              )}
            </div>
          </div>

          {/* Mobile: the same data as tappable cards, no horizontal scrolling */}
          <ul className="flex flex-col gap-2 sm:hidden">
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(row.id)}
                  className={`${CARD_CLASS} w-full p-3 text-left transition-colors active:bg-ws-hover`}
                  style={row.id === selectedId ? { boxShadow: `inset 2px 0 0 ${brandColor}` } : undefined}
                >
                  <div className="flex items-center gap-2.5">
                    <HealthAvatar name={row.name} health={row.health} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ws-text">
                        {row.name ?? "Unnamed customer"} {row.isDemo && <DemoChip />}
                      </span>
                      <span className="block truncate text-[11.5px] text-ws-text-3">{row.contact}</span>
                    </span>
                    <SignalChip signal={row.signal} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <PlateCell plates={row.plates} />
                    <span className={`text-[12.5px] ${DUE_TEXT_CLASS[row.nextDueUrgency]}`}>{row.nextDue}</span>
                    {row.balance > 0 && (
                      <span className="text-[12.5px] font-semibold tabular-nums text-ws-amber">
                        {fmtGBP(row.balance)}
                      </span>
                    )}
                    <span className="text-[12.5px] text-ws-text-3">{row.lastIn}</span>
                  </div>
                </button>
              </li>
            ))}
            {rows.length === 0 && (
              <li className="p-8 text-center font-mono text-xs text-ws-text-3">
                {"// NO CUSTOMERS MATCH — CLEAR SEARCH OR SEGMENT"}
              </li>
            )}
          </ul>

          <p className="mt-2.5 hidden font-mono text-[10px] tracking-[0.1em] text-ws-text-3 sm:block">
            ↑↓ SELECT · ENTER OPEN RECORD · / SEARCH
          </p>

          {matchCount > pageSize && (
            <div className="mt-3">
              <Pagination
                page={page}
                pageSize={pageSize}
                totalCount={matchCount}
                basePath="/staff/customers"
                extraParams={pageParams.toString()}
              />
            </div>
          )}
        </div>

        {selected && (
          <>
            {/* Under xl the panel is an overlay sheet — the table keeps full width */}
            <div
              className="fixed inset-0 z-30 bg-black/50 xl:hidden"
              onClick={() => setSelectedId(null)}
              aria-hidden
            />
            <div className="fixed inset-x-0 bottom-0 z-40 max-h-[85vh] overflow-y-auto p-3 xl:static xl:z-auto xl:max-h-none xl:overflow-visible xl:p-0">
              <PreviewPanel
                row={selected}
                brandColor={brandColor}
                onBrand={onBrand}
                onClose={() => setSelectedId(null)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PlateCell({ plates }: { plates: string[] }) {
  if (plates.length === 0) return <span className="text-[11px] text-ws-text-3">—</span>;
  const extra = plates.length - 2;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {plates.slice(0, 2).map((p) => (
        <PlateChip key={p} reg={p} />
      ))}
      {extra > 0 && <span className="text-[11px] text-ws-text-3">+{extra}</span>}
    </span>
  );
}

function DensityButton({
  label,
  active,
  onClick,
  lines,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  lines: 3 | 4;
}) {
  const ys = lines === 3 ? [6, 12, 18] : [5, 9.5, 14, 18.5];
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`grid w-[38px] place-items-center transition-colors ${
        active ? "bg-ws-hover text-ws-text" : "text-ws-text-3 hover:text-ws-text-2"
      }`}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        {ys.map((y) => (
          <path key={y} d={`M3 ${y}h18`} />
        ))}
      </svg>
    </button>
  );
}
