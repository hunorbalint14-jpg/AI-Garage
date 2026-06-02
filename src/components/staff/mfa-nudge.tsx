"use client";

import { useState } from "react";
import Link from "next/link";
import { ShieldAlert, X } from "lucide-react";

// Dismissible banner nudging owners/admins to set up MFA before enforcement is
// turned on. Dismissal is in-memory (persists across client-side navigation,
// returns on a full reload) — enough to stop it nagging mid-session without a
// localStorage effect.
export function MfaNudge({ hasPasskey }: { hasPasskey: boolean }) {
  const [show, setShow] = useState(true);
  if (!show) return null;

  return (
    <div className="flex items-center gap-3 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-200">
      <ShieldAlert className="h-4 w-4 shrink-0" />
      <span className="flex-1">
        {hasPasskey
          ? "Two-factor sign-in will soon be required for owners and admins."
          : "Secure your account: set up two-factor sign-in with a passkey before it becomes required."}{" "}
        <Link href="/staff/mfa" className="font-semibold underline underline-offset-2">
          {hasPasskey ? "Verify now" : "Set it up"}
        </Link>
      </span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setShow(false)}
        className="shrink-0 rounded p-1 text-amber-200/70 transition-colors hover:text-amber-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
