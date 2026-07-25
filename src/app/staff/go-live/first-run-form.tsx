"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveFirstRunPolicy } from "./actions";

// The two release choices (#587), set before going live rather than discovered
// the morning after. Both are plain settings — nothing here sends anything.
export function FirstRunForm({
  cap,
  chasePreliveDebt,
  preliveDebtCount,
  canEdit,
}: {
  cap: number | null;
  chasePreliveDebt: boolean;
  preliveDebtCount: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [capValue, setCapValue] = useState(cap == null ? "" : String(cap));
  const [chase, setChase] = useState(chasePreliveDebt);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    setSaved(false);
    const trimmed = capValue.trim();
    startTransition(async () => {
      const res = await saveFirstRunPolicy({
        cap: trimmed === "" ? null : Number(trimmed),
        chasePreliveDebt: chase,
      });
      if ("error" in res) setError(res.error);
      else {
        setSaved(true);
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label htmlFor="first-run-cap">Messages on your first day</Label>
        <Input
          id="first-run-cap"
          inputMode="numeric"
          value={capValue}
          disabled={!canEdit || pending}
          placeholder="No limit"
          onChange={(e) => setCapValue(e.target.value)}
          className="max-w-[10rem]"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Applies for 24 hours after you go live. Anything over the limit isn&apos;t dropped — it goes out on the next
          run, so the backlog drains over a few days instead of landing at once. Leave blank for no limit.
        </p>
      </div>

      <div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={chase}
            disabled={!canEdit || pending}
            onChange={(e) => setChase(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Also chase invoices that were already overdue before you went live
            {preliveDebtCount > 0 && (
              <span className="ml-1 text-muted-foreground">({preliveDebtCount} right now)</span>
            )}
          </span>
        </label>
        <p className="mt-1 text-xs text-muted-foreground">
          Off by default. Old debt is often already settled off-system or disputed, so chasing it automatically on day
          one tends to cause more calls than it collects. You can still chase any invoice by hand.
        </p>
      </div>

      {canEdit && (
        <div className="flex items-center gap-3">
          <Button size="sm" variant="outline" onClick={save} loading={pending}>
            Save
          </Button>
          {saved && <span className="text-xs text-ws-green">Saved</span>}
        </div>
      )}
      {error && <p className="text-sm text-ws-red">{error}</p>}
    </div>
  );
}
