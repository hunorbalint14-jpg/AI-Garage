"use client";

import { useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveQuoteReminderSettings } from "./quote-reminder-actions";

export function QuoteRemindersSection({
  initialEnabled,
  initialDays,
  initialMax,
  canManage,
}: {
  initialEnabled: boolean;
  initialDays: number[];
  initialMax: number;
  canManage: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [days, setDays] = useState<string[]>(initialDays.length ? initialDays.map(String) : ["3", "7"]);
  const [maxCount, setMaxCount] = useState(String(initialMax || 2));
  const [pending, startTransition] = useTransition();
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const result = await saveQuoteReminderSettings({
        enabled,
        days: days.map((d) => Number(d)),
        maxCount: Number(maxCount),
      });
      if ("error" in result) setError(result.error);
      else {
        setDays(result.days.map(String));
        setInfo(
          result.enabled
            ? `Automatic reminders on day ${result.days.join(", day ")} after sending (max ${result.maxCount}).`
            : "Automatic reminders switched off.",
        );
      }
    });
  }

  return (
    <section className="rounded-lg border p-5 flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold">Quote reminders</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Chase customers who haven&apos;t responded to a quote. Automatic reminders go out on the
          schedule below (and stop at expiry); staff can also send one manually from any pending
          quote.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            disabled={pending || !canManage}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Enable automatic quote reminders
        </label>

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Reminder schedule (days after sending)</Label>
          <div className="flex flex-wrap items-center gap-2">
            {days.map((d, idx) => (
              <span key={idx} className="flex items-center gap-1">
                <Input
                  type="number"
                  min="1"
                  max="365"
                  value={d}
                  onChange={(e) => setDays((prev) => prev.map((v, i) => (i === idx ? e.target.value : v)))}
                  disabled={pending || !canManage || !enabled}
                  className="w-20"
                  aria-label={`Reminder day ${idx + 1}`}
                />
                <button
                  type="button"
                  onClick={() => setDays((prev) => prev.filter((_, i) => i !== idx))}
                  disabled={pending || !canManage || !enabled || days.length === 1}
                  aria-label="Remove day"
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setDays((prev) => [...prev, ""])}
              disabled={pending || !canManage || !enabled || days.length >= 10}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Add day
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="quote-reminder-max" className="text-xs">Maximum automatic reminders per quote</Label>
            <Input
              id="quote-reminder-max"
              type="number"
              min="1"
              max="10"
              value={maxCount}
              onChange={(e) => setMaxCount(e.target.value)}
              disabled={pending || !canManage || !enabled}
              className="w-24"
            />
          </div>
          <Button type="submit" disabled={!canManage} loading={pending}>Save</Button>
        </div>
      </form>

      <p className="text-xs text-muted-foreground">
        Reminders reuse the channels the quote originally went out on. Platform defaults: day 3 &amp; 7, max 2.
      </p>
      {!canManage && (
        <p className="text-xs text-muted-foreground">Only owners and admins can change this.</p>
      )}
      {info && <p className="text-sm text-ws-green">{info}</p>}
      {error && <p className="text-sm text-ws-red">{error}</p>}
    </section>
  );
}
