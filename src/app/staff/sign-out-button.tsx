"use client";

import { useTransition } from "react";
import { AigSpinner } from "@/components/ui/aig-spinner";
import { signOutWithAudit } from "@/app/sign-out-action";

export function SignOutButton({ dark = true }: { dark?: boolean }) {
  const [pending, startTransition] = useTransition();

  function handleSignOut() {
    startTransition(async () => {
      await signOutWithAudit("staff");
      window.location.href = "/staff/login";
    });
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={handleSignOut}
      className={`inline-flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
        dark
          ? "border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white"
          : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900"
      }`}
    >
      {pending && <AigSpinner />}
      Sign out
    </button>
  );
}
