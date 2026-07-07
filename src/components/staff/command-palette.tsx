"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  User,
  Car,
  Receipt,
  Wrench,
  CalendarDays,
  FileText,
  CornerDownLeft,
  CalendarPlus,
  UserPlus,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { globalSearch, type SearchHit, type SearchResults } from "@/app/staff/search-actions";

// Create-verbs (UX review F16): the palette also creates, not just finds.
// navKey ties each action to the staff-modules nav item key so the palette
// offers exactly what the nav shows this user (permissions applied upstream
// in StaffShell via filterModulesForRole).
type PaletteAction = { label: string; href: string; icon: LucideIcon; navKey: string };

const ACTIONS: PaletteAction[] = [
  { label: "New booking", href: "/staff/bookings/new", icon: CalendarPlus, navKey: "bookings" },
  { label: "New quote", href: "/staff/quotes/new", icon: FileText, navKey: "quotes" },
  { label: "New customer", href: "/staff/customers/new", icon: UserPlus, navKey: "customers" },
  { label: "Go to settings", href: "/staff/settings", icon: Settings, navKey: "settings" },
];

// "new b" → "New booking": the whole label, or any word of it, starts with
// the query. Actions stay reachable while typing without stealing the list
// from real search hits.
function actionMatches(label: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const l = label.toLowerCase();
  return l.startsWith(q) || l.split(/\s+/).some((w) => w.startsWith(q));
}

const OPEN_EVENT = "staff:open-command-palette";

/** Open the palette from anywhere (e.g. the mobile header search button). */
export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

const EMPTY: SearchResults = {
  customers: [],
  vehicles: [],
  jobs: [],
  bookings: [],
  quotes: [],
  invoices: [],
};

// Cmd/Ctrl+K global search across customers, registrations, jobs, bookings,
// quotes and invoices. Front-desk flow: phone rings → type the reg or a name
// → Enter → record.
export function CommandPalette({ allowedNavKeys }: { allowedNavKeys?: string[] }) {
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
    setSelected(0); // action list re-narrows with every keystroke
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

  // Actions this user may see (nav-gated), narrowed by the query. On an empty
  // query all of them show; while typing they stay reachable via prefix match.
  const visibleActions = useMemo(() => {
    const allowed = allowedNavKeys
      ? ACTIONS.filter((a) => allowedNavKeys.includes(a.navKey))
      : ACTIONS;
    return allowed.filter((a) => actionMatches(a.label, query));
  }, [allowedNavKeys, query]);

  // Flat list across groups for keyboard navigation — actions first, then
  // search hits, one continuous arrow-key sequence.
  const groups: { label: string; icon: typeof User; hits: SearchHit[] }[] = [
    { label: "Customers", icon: User, hits: results.customers },
    { label: "Vehicles", icon: Car, hits: results.vehicles },
    { label: "Jobs", icon: Wrench, hits: results.jobs },
    { label: "Bookings", icon: CalendarDays, hits: results.bookings },
    { label: "Quotes", icon: FileText, hits: results.quotes },
    { label: "Invoices", icon: Receipt, hits: results.invoices },
  ].filter((g) => g.hits.length > 0);
  const searchFlat = groups.flatMap((g) => g.hits);
  const flat: { href: string }[] = [...visibleActions, ...searchFlat];

  const navigate = useCallback(
    (hit: { href: string } | undefined) => {
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
            placeholder="Search name, reg, phone, job, booking, quote, invoice №…"
            className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-[#5a6170]"
          />
          <kbd className="hidden sm:block rounded border border-[#2a2f37] px-1.5 py-0.5 font-mono text-[10px] text-[#5a6170]">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[55vh] overflow-y-auto p-2">
          {/* Create-verbs — styled exactly like a result group, keyboard
              indices 0..n-1 so Cmd+K → Enter fires the first action. */}
          {visibleActions.length > 0 && (
            <div className="mb-1">
              <div className="flex items-center gap-1.5 px-3 pb-1 pt-2">
                <CornerDownLeft className="h-3 w-3 text-[#5a6170]" />
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#5a6170]">
                  Actions
                </span>
              </div>
              {visibleActions.map((action, i) => {
                const AIcon = action.icon;
                const isSelected = i === selected;
                return (
                  <button
                    key={action.href}
                    onClick={() => navigate(action)}
                    onMouseEnter={() => setSelected(i)}
                    className={
                      "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left " +
                      (isSelected ? "bg-[#22272e]" : "")
                    }
                  >
                    <AIcon className="h-4 w-4 shrink-0 text-[#9aa1ad]" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {action.label}
                    </span>
                    {isSelected && (
                      <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-[#5a6170]" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {query.trim().length < 2 ? (
            <p className="px-3 py-6 text-center text-sm text-[#5a6170]">
              Type at least 2 characters — customers, regs, jobs, bookings, quotes, invoices.
            </p>
          ) : searching && searchFlat.length === 0 ? (
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
