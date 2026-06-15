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
}: {
  branches: Branch[];
  currentId: string | null;
  action: (locationId: string) => Promise<unknown>;
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

  return (
    <span className="inline-flex items-center gap-2">
      <select
        value={value}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-current/20 bg-transparent px-2 py-1 text-sm outline-none disabled:opacity-50"
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
