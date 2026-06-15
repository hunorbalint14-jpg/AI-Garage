"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Branch = { id: string; name: string };

// Inline "home garage" picker. The customer's home/preferred branch
// (customers.preferred_location_id). Auto-saves on change via the supplied
// server action. Used on both the staff customer page and the customer portal
// settings — each passes its own (permission-/session-checked) action.
export function HomeGarageSelect({
  branches,
  currentId,
  action,
  dark = false,
}: {
  branches: Branch[];
  currentId: string | null;
  action: (locationId: string) => Promise<unknown>;
  // Dark portal theme vs light staff theme — a bare transparent select is
  // invisible (dark option text) on the dark portal, so style explicitly.
  dark?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(currentId ?? "");
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function onChange(next: string) {
    if (!next || next === value) return;
    const prev = value;
    setValue(next);
    setMsg(null);
    startTransition(async () => {
      const res = await action(next);
      const err =
        res && typeof res === "object" && "error" in res ? (res as { error?: string }).error : undefined;
      if (err) {
        setValue(prev);
        setMsg({ ok: false, text: err });
        return;
      }
      setMsg({ ok: true, text: "Saved" });
      router.refresh();
    });
  }

  const selectCls = dark
    ? "rounded-md border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/40 disabled:opacity-50 [&>option]:text-black"
    : "rounded-md border bg-background px-2 py-1 text-sm text-foreground outline-none disabled:opacity-50";

  return (
    <span className="inline-flex items-center gap-2">
      <select
        value={value}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
        className={selectCls}
      >
        {currentId === null && <option value="">Not set</option>}
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      {msg && <span className={`text-xs ${msg.ok ? "text-green-500" : "text-red-500"}`}>{msg.text}</span>}
    </span>
  );
}
