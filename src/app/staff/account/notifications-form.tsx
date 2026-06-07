"use client";

import { useState, useTransition } from "react";
import { updateDigestPref } from "./actions";

export function NotificationsForm({ weeklyDigest }: { weeklyDigest: boolean }) {
  const [on, setOn] = useState(weeklyDigest);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(next: boolean) {
    setError(null);
    setOn(next);
    start(async () => {
      const res = await updateDigestPref(next);
      if ("error" in res) {
        setOn(!next); // revert on failure
        setError(res.error);
      }
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
        Email notifications
      </h2>

      <label className="flex items-start justify-between gap-4">
        <span>
          <span className="block text-sm font-medium">Weekly summary email</span>
          <span className="block text-xs text-muted-foreground">
            A weekly digest of vehicles due for MOT or service across your locations.
          </span>
        </span>
        <input
          type="checkbox"
          checked={on}
          disabled={pending}
          onChange={(e) => toggle(e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0"
          aria-label="Weekly summary email"
        />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}
