"use client";

import { useState, useTransition } from "react";
import { acceptDpa } from "./actions";
import { Button } from "@/components/ui/button";

export function AcceptForm() {
  const [checked, setChecked] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleAccept() {
    if (!checked) return;
    setError(null);
    startTransition(async () => {
      const result = await acceptDpa();
      if (result && "error" in result) setError(result.error);
    });
  }

  return (
    <div className="mt-6 flex flex-col gap-3">
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border"
        />
        <span>
          I confirm I have authority to bind the garage business and accept the Data Processing Agreement
          on its behalf. I understand my user identity and the time of acceptance will be recorded.
        </span>
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <Button onClick={handleAccept} disabled={!checked || pending}>
          {pending ? "Accepting…" : "Accept and continue"}
        </Button>
      </div>
    </div>
  );
}
