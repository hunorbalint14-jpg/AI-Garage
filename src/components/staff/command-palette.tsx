"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, User, Car, Receipt, CornerDownLeft } from "lucide-react";
import { globalSearch, type SearchHit, type SearchResults } from "@/app/staff/search-actions";

const OPEN_EVENT = "staff:open-command-palette";

/** Open the palette from anywhere (e.g. the mobile header search button). */
export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

const EMPTY: SearchResults = { customers: [], vehicles: [], invoices: [] };

// Cmd/Ctrl+K global search across customers, registrations and invoices.
// Front-desk flow: phone rings → type the reg or a name → Enter → record.
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Open with a clean slate every time. The component renders null while
  // closed, so the input remounts and autoFocus handles focus.
  const openFresh = useCallback(() => {
    setQuery("");
    setResults(EMPTY);
    setSelected(0);
    setSearching(false);
    setOpen(true);
  }, []);

  // Open via keyboard shortcut or the custom event (mobile button).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => {
          if (o) return false;
          // Reset synchronously alongside opening.
          setQuery("");
          setResults(EMPTY);
          setSelected(0);
          setSearching(false);
          return true;
        });
      }
    };
    const onOpen = () => openFresh();
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, [openFresh]);

  const runSearch = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) {
      setResults(EMPTY);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const seq = ++requestSeq.current;
      try {
        const res = await globalSearch(q);
        if (seq === requestSeq.current) {
          setResults(res);
          setSelected(0);
        }
      } finally {
        if (seq === requestSeq.current) setSearching(false);
      }
    }, 200);
  }, []);

  // Flat list across groups for keyboard navigation.
  const groups: { label: string; icon: typeof User; hits: SearchHit[] }[] = [
    { label: "Customers", icon: User, hits: results.customers },
    { label: "Vehicles", icon: Car, hits: results.vehicles },
    { label: "Invoices", icon: Receipt, hits: results.invoices },
  ].filter((g) => g.hits.length > 0);
  const flat = groups.flatMap((g) => g.hits);

  const navigate = useCallback(
    (hit: SearchHit | undefined) => {
      if (!hit) return;
      setOpen(false);
      router.push(hit.href);
    },
    [router],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60]">
      <button
        aria-label="Close search"
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-black/50 cursor-default"
      />
      <div className="absolute left-1/2 top-[12%] w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-[#2a2f37] bg-[#15181d] text-[#e6e8eb] shadow-2xl">
        {/* Input row */}
        <div className="flex items-center gap-2.5 border-b border-[#2a2f37] px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-[#5a6170]" />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              runSearch(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelected((s) => Math.min(s + 1, flat.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelected((s) => Math.max(s - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                navigate(flat[selected]);
              }
            }}
            placeholder="Search name, reg, phone or invoice №…"
            className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-[#5a6170]"
          />
          <kbd className="hidden sm:block rounded border border-[#2a2f37] px-1.5 py-0.5 font-mono text-[10px] text-[#5a6170]">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[55vh] overflow-y-auto p-2">
          {query.trim().length < 2 ? (
            <p className="px-3 py-6 text-center text-sm text-[#5a6170]">
              Type at least 2 characters — customers, registrations, invoices.
            </p>
          ) : searching && flat.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-[#5a6170]">Searching…</p>
          ) : flat.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-[#5a6170]">
              No matches for &ldquo;{query}&rdquo;.
            </p>
          ) : (
            groups.map((g) => {
              const GIcon = g.icon;
              // Index offset of this group's first item in the flat list.
              const offset = flat.indexOf(g.hits[0]);
              return (
                <div key={g.label} className="mb-1">
                  <div className="flex items-center gap-1.5 px-3 pb-1 pt-2">
                    <GIcon className="h-3 w-3 text-[#5a6170]" />
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#5a6170]">
                      {g.label}
                    </span>
                  </div>
                  {g.hits.map((hit, i) => {
                    const flatIndex = offset + i;
                    const isSelected = flatIndex === selected;
                    return (
                      <button
                        key={`${hit.href}-${i}`}
                        onClick={() => navigate(hit)}
                        onMouseEnter={() => setSelected(flatIndex)}
                        className={
                          "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left " +
                          (isSelected ? "bg-[#22272e]" : "")
                        }
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">{hit.title}</span>
                            {hit.badge && (
                              <span className="shrink-0 rounded bg-[#22272e] px-1.5 py-0.5 font-mono text-xs">
                                {hit.badge}
                              </span>
                            )}
                          </div>
                          {hit.subtitle && (
                            <div className="truncate text-xs text-[#9aa1ad]">{hit.subtitle}</div>
                          )}
                        </div>
                        {isSelected && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-[#5a6170]" />}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
