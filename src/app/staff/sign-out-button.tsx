"use client";

import { useTransition } from "react";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const supabase = createClient();
  const [pending, startTransition] = useTransition();

  function handleSignOut() {
    startTransition(async () => {
      await supabase.auth.signOut();
      window.location.href = "/staff/login";
    });
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={handleSignOut}
      className="w-full rounded-lg border border-white/10 bg-white/5 py-1.5 text-xs font-medium text-gray-300 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
