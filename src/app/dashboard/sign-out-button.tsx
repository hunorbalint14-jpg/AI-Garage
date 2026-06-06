"use client";

import { useTransition } from "react";
import { AigSpinner } from "@/components/ui/aig-spinner";
import { signOutWithAudit } from "@/app/sign-out-action";

export function CustomerSignOutButton() {
  const [pending, startTransition] = useTransition();

  function handleSignOut() {
    startTransition(async () => {
      await signOutWithAudit("customer");
      window.location.href = "/login";
    });
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={handleSignOut}
      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50"
    >
      {pending && <AigSpinner />}
      Sign out
    </button>
  );
}
