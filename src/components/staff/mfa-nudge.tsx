"use client";

import { useState } from "react";
import Link from "next/link";
import { ShieldAlert, X } from "lucide-react";
import { MFA_NUDGE_DISMISSED_COOKIE, MFA_NUDGE_RENAG_DAYS } from "@/lib/mfa-nudge-shared";

// Dismissible banner nudging owners/admins to set up MFA before enforcement is
// turned on. Only shown to users who haven't enrolled a passkey yet (see the
// layout gate). Dismissal drops a cookie read by the layout gate, so the banner
// stays gone across reloads and sessions and re-nags after MFA_NUDGE_RENAG_DAYS.
export function MfaNudge({ userId }: { userId: string }) {
  const [show, setShow] = useState(true);
  if (!show) return null;

  function dismiss() {
    const maxAge = MFA_NUDGE_RENAG_DAYS * 24 * 60 * 60;
    document.cookie = `${MFA_NUDGE_DISMISSED_COOKIE}=${userId}; path=/; max-age=${maxAge}; samesite=lax`;
    setShow(false);
  }

  return (
    <div className="mb-6 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
      <ShieldAlert className="h-5 w-5 shrink-0 text-amber-400" />
      <span className="flex-1 leading-snug">
        Secure your account: set up two-factor sign-in with a passkey before it becomes required.{" "}
        <Link href="/staff/mfa" className="font-semibold text-amber-100 underline underline-offset-2 hover:text-white">
          Set it up
        </Link>
      </span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={dismiss}
        className="shrink-0 rounded p-1 text-amber-300/70 transition-colors hover:text-amber-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
