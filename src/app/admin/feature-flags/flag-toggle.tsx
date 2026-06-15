"use client";

import { useState, useTransition } from "react";
import { setFeatureFlag } from "./actions";

// Optimistic on/off switch for one feature flag. Flips immediately, calls the
// server action, and rolls back + surfaces the message if it fails.
export function FlagToggle({
  flagKey,
  initialEnabled,
}: {
  flagKey: string;
  initialEnabled: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !enabled;
    setEnabled(next); // optimistic
    setError(null);
    startTransition(async () => {
      const res = await setFeatureFlag(flagKey, next);
      if ("error" in res) {
        setEnabled(!next); // rollback
        setError(res.error);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={`Toggle ${flagKey}`}
        onClick={toggle}
        disabled={pending}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
          enabled ? "bg-[#22c55e]" : "bg-[#2a2f37]"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            enabled ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </button>
      {error && <span className="max-w-44 text-right text-[10px] text-[#ff7b7b]">{error}</span>}
    </div>
  );
}
