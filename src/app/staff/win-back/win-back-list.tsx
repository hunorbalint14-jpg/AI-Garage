"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { draftWinBackPreview, sendWinBack, dismissWinBack } from "./actions";

const TEXTAREA_CLASS =
  "w-full rounded-md border border-black/20 dark:border-white/25 bg-transparent px-3 py-2 text-sm shadow-sm resize-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

export type WinBackVehicle = {
  vehicleId: string;
  registration: string;
  make: string | null;
  model: string | null;
  year: number | null;
  motExpiry: string | null;
  lastMotTestDate: string | null;
  flaggedAt: string;
  customerId: string;
  customerName: string | null;
  hasEmail: boolean;
  hasPhone: boolean;
  emailConsent: boolean;
  smsConsent: boolean;
};

type ComposerState = {
  vehicleId: string;
  phase: "drafting" | "ready" | "sending";
  subject: string;
  emailText: string;
  smsText: string;
  error: string | null;
};

function formatDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function WinBackList({ vehicles }: { vehicles: WinBackVehicle[] }) {
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [channels, setChannels] = useState<Set<"email" | "sms" | "whatsapp">>(new Set(["email"]));
  const [notice, setNotice] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (vehicles.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
        No win-back candidates right now. Vehicles appear here when the nightly MOT sync spots a
        fresh test with no booking or job at this garage around the test date.
      </div>
    );
  }

  function openComposer(v: WinBackVehicle) {
    setNotice(null);
    setComposer({
      vehicleId: v.vehicleId,
      phase: "drafting",
      subject: "",
      emailText: "",
      smsText: "",
      error: null,
    });
    setChannels(new Set([v.emailConsent && v.hasEmail ? "email" : "sms"]));
    startTransition(async () => {
      const result = await draftWinBackPreview(v.vehicleId);
      setComposer((prev) => {
        if (!prev || prev.vehicleId !== v.vehicleId) return prev;
        if ("error" in result) return { ...prev, phase: "ready", error: result.error };
        return {
          ...prev,
          phase: "ready",
          subject: result.subject,
          emailText: result.email,
          smsText: result.sms,
          error: null,
        };
      });
    });
  }

  function handleSend() {
    if (!composer || composer.phase !== "ready") return;
    const { vehicleId, subject, emailText, smsText } = composer;
    setComposer({ ...composer, phase: "sending" });
    startTransition(async () => {
      const result = await sendWinBack(vehicleId, subject, emailText || null, smsText || null, {
        email: channels.has("email"),
        sms: channels.has("sms"),
        whatsapp: channels.has("whatsapp"),
      });
      if ("error" in result) {
        setComposer((prev) => (prev ? { ...prev, phase: "ready", error: result.error } : prev));
      } else {
        setComposer(null);
        setNotice(`Win-back sent via ${result.channels.join(", ")}.`);
      }
    });
  }

  function handleDismiss(vehicleId: string) {
    setNotice(null);
    startTransition(async () => {
      const result = await dismissWinBack(vehicleId);
      if ("error" in result) setNotice(result.error);
    });
  }

  function toggleChannel(ch: "email" | "sms" | "whatsapp") {
    setChannels((prev) => {
      const next = new Set(prev);
      if (next.has(ch)) next.delete(ch);
      else next.add(ch);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {notice && (
        <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm">
          {notice}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">Vehicle</th>
              <th className="px-3 py-2 font-medium">Customer</th>
              <th className="px-3 py-2 font-medium">MOT tested</th>
              <th className="px-3 py-2 font-medium">New expiry</th>
              <th className="px-3 py-2 font-medium">Flagged</th>
              <th className="px-3 py-2 font-medium">Contact</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {vehicles.map((v) => {
              const canEmail = v.hasEmail && v.emailConsent;
              const canSms = v.hasPhone && v.smsConsent;
              const isOpen = composer?.vehicleId === v.vehicleId;
              return (
                <tr key={v.vehicleId} className="border-b last:border-b-0 align-top">
                  <td className="px-3 py-2">
                    <span className="font-medium">{v.registration}</span>
                    <span className="block text-xs text-muted-foreground">
                      {[v.year, v.make, v.model].filter(Boolean).join(" ") || "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2">{v.customerName ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums">{formatDate(v.lastMotTestDate)}</td>
                  <td className="px-3 py-2 tabular-nums">{formatDate(v.motExpiry)}</td>
                  <td className="px-3 py-2 tabular-nums">{formatDate(v.flaggedAt)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {canEmail && <span className="mr-2">email ✓</span>}
                    {canSms && <span className="mr-2">SMS ✓</span>}
                    {!canEmail && !canSms && <span>no marketing consent</span>}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Button
                      size="sm"
                      variant="outline"
                      className="mr-2"
                      disabled={(!canEmail && !canSms) || isOpen}
                      onClick={() => openComposer(v)}
                    >
                      Draft message
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDismiss(v.vehicleId)}>
                      Dismiss
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {composer && (
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              Win-back message —{" "}
              {vehicles.find((v) => v.vehicleId === composer.vehicleId)?.registration}
            </h2>
            <Button size="sm" variant="ghost" onClick={() => setComposer(null)}>
              Close
            </Button>
          </div>

          {composer.phase === "drafting" ? (
            <p className="text-sm text-muted-foreground">Drafting with AI…</p>
          ) : (
            <>
              {composer.error && <p className="text-sm text-destructive">{composer.error}</p>}

              <label className="text-xs font-medium text-muted-foreground">
                Subject (email)
                <input
                  className="mt-1 w-full rounded-md border border-black/20 dark:border-white/25 bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={composer.subject}
                  onChange={(e) => setComposer({ ...composer, subject: e.target.value })}
                  disabled={composer.phase === "sending"}
                />
              </label>

              <label className="text-xs font-medium text-muted-foreground">
                Email body
                <textarea
                  className={`${TEXTAREA_CLASS} mt-1`}
                  rows={6}
                  value={composer.emailText}
                  onChange={(e) => setComposer({ ...composer, emailText: e.target.value })}
                  disabled={composer.phase === "sending"}
                />
              </label>

              <label className="text-xs font-medium text-muted-foreground">
                SMS / WhatsApp body
                <textarea
                  className={`${TEXTAREA_CLASS} mt-1`}
                  rows={3}
                  value={composer.smsText}
                  onChange={(e) => setComposer({ ...composer, smsText: e.target.value })}
                  disabled={composer.phase === "sending"}
                />
              </label>

              <div className="flex items-center gap-4 text-sm">
                {(["email", "sms", "whatsapp"] as const).map((ch) => (
                  <label key={ch} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={channels.has(ch)}
                      onChange={() => toggleChannel(ch)}
                      disabled={composer.phase === "sending"}
                    />
                    {ch === "sms" ? "SMS" : ch === "whatsapp" ? "WhatsApp" : "Email"}
                  </label>
                ))}
                <span className="ml-auto">
                  <Button size="sm" onClick={handleSend} disabled={composer.phase === "sending" || channels.size === 0}>
                    {composer.phase === "sending" ? "Sending…" : "Send"}
                  </Button>
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Channels without marketing consent are skipped automatically. Sending removes the
                vehicle from this list.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
