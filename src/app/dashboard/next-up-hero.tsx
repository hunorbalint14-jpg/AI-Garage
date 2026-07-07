"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { AigSpinner } from "@/components/ui/aig-spinner";
import { requestBooking } from "./book/actions";
import type { SlotDay } from "@/lib/slots";

// "Next up" hero (UX review §1g): the single most urgent item across all
// vehicles ∪ pending quotes leads the page, with real bookable slots inline.

export type HeroAction =
  | {
      kind: "mot" | "service";
      vehicleId: string;
      vehicleName: string;
      registration: string;
      dueDate: string; // ISO date
      dueDays: number;
      service: { id: string; name: string; price: number | null; durationMinutes: number } | null;
      locationId: string;
      week: SlotDay[] | null;
    }
  | {
      kind: "quote";
      quoteId: string;
      title: string | null;
      total: number;
      expiresDays: number | null;
    };

function fmtDue(iso: string): string {
  return new Date(iso)
    .toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    .toUpperCase();
}

function slotLabel(date: string, time: string): string {
  const d = new Date(`${date}T${time}`);
  return `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" })} · ${time}`;
}

function slotLong(date: string, time: string): string {
  const d = new Date(`${date}T${time}`);
  return `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}, ${time}`;
}

export function NextUpHero({ action, orgColor }: { action: HeroAction; orgColor: string }) {
  const [dismissed, setDismissed] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);

  // The bookable variant, or null for the quote hero — gives closures below a
  // stably-narrowed reference.
  const bookable = action.kind === "quote" ? null : action;

  // First available slot per open day, three days deep — the "pick one" chips.
  const suggestions = useMemo(() => {
    if (!bookable?.week) return [];
    const out: { date: string; time: string }[] = [];
    for (const day of bookable.week) {
      if (!day.open) continue;
      const free = day.slots.find((s) => s.available);
      if (free) out.push({ date: day.date, time: free.time });
      if (out.length === 3) break;
    }
    return out;
  }, [bookable]);

  if (dismissed) return null;

  const surface = {
    border: `1px solid ${orgColor}72`,
    background: `linear-gradient(180deg, ${orgColor}24, ${orgColor}0D)`,
  };

  if (action.kind === "quote") {
    return (
      <div className="rounded-2xl p-5" style={surface}>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-red-300">
          Next up{action.expiresDays !== null ? ` · expires in ${action.expiresDays}d` : ""}
        </p>
        <h2 className="mt-1.5 text-xl font-bold leading-snug">
          Quote for £{Math.round(action.total)} waiting — approve or ask a question
        </h2>
        {action.title && <p className="mt-1 text-sm text-gray-300">{action.title}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link
            href={`/dashboard/quotes/${action.quoteId}`}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: orgColor }}
          >
            Review &amp; approve →
          </Link>
          <Link href="/dashboard/quotes" className="text-xs text-gray-400 underline hover:text-white">
            see all quotes
          </Link>
        </div>
      </div>
    );
  }

  const kindLabel = action.kind === "mot" ? "MOT" : "service";
  const chosen = suggestions[selected] ?? null;

  function book() {
    if (!chosen || !bookable?.service) return;
    setError(null);
    const fd = new FormData();
    fd.set("vehicleId", bookable.vehicleId);
    fd.set("serviceId", bookable.service.id);
    fd.set("scheduledAt", `${chosen.date}T${chosen.time}`);
    fd.set("locationId", bookable.locationId);
    startTransition(async () => {
      const result = await requestBooking(fd);
      if ("error" in result) setError(result.error);
      else if (result.paymentUrl) window.location.href = result.paymentUrl;
      else setBooked(slotLong(chosen.date, chosen.time));
    });
  }

  if (booked) {
    return (
      <div className="rounded-2xl p-5" style={surface}>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-green-300">
          Booked ✓
        </p>
        <h2 className="mt-1.5 text-xl font-bold leading-snug">
          {kindLabel === "MOT" ? "MOT" : "Service"} booked — {booked}
        </h2>
        <p className="mt-1 text-sm text-gray-300">
          {action.registration} · confirmation is on its way to your inbox.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl p-5" style={surface}>
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-red-300">
        Next up · due {fmtDue(action.dueDate)}
      </p>
      <h2 className="mt-1.5 text-xl font-bold leading-snug">
        Your {kindLabel} is {action.dueDays < 0 ? `${Math.abs(action.dueDays)} days overdue` : `due in ${action.dueDays} days`}
      </h2>
      <p className="mt-1 text-sm text-gray-300">
        {action.vehicleName} · <span className="font-mono text-xs font-bold tracking-wider">{action.registration}</span>
        {action.service && (
          <>
            {" "}· {action.service.name}
            {action.service.price != null && ` £${action.service.price}`}
          </>
        )}
      </p>

      {suggestions.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {suggestions.map((s, i) => {
            const isSel = i === selected;
            return (
              <button
                key={`${s.date}T${s.time}`}
                type="button"
                onClick={() => setSelected(i)}
                aria-pressed={isSel}
                className="rounded-lg border px-3 py-2 text-xs font-semibold transition-colors"
                style={
                  isSel
                    ? { backgroundColor: orgColor, borderColor: orgColor, color: "#fff" }
                    : { borderColor: "rgba(255,255,255,0.15)", color: "#fff" }
                }
              >
                {slotLabel(s.date, s.time)}
              </button>
            );
          })}
          <Link
            href="/dashboard/book"
            className="rounded-lg border border-white/15 px-3 py-2 text-xs font-medium text-gray-300 hover:text-white"
          >
            More times →
          </Link>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {action.service && chosen ? (
          <button
            type="button"
            onClick={book}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ backgroundColor: orgColor }}
          >
            {pending && <AigSpinner />}
            Book {kindLabel} — {slotLong(chosen.date, chosen.time)}
          </button>
        ) : (
          <Link
            href="/dashboard/book"
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: orgColor }}
          >
            Book {kindLabel} →
          </Link>
        )}
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-xs text-gray-400 underline hover:text-white"
        >
          remind me later
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
