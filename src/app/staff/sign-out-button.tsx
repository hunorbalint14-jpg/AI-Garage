"use client";

import { useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const supabase = createClient();
  const [pending, startTransition] = useTransition();

  function handleSignOut() {
    startTransition(async () => {
      await supabase.auth.signOut();
      // Full reload clears the cached layout so the sidebar disappears cleanly.
      window.location.href = "/staff/login";
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleSignOut}
      disabled={pending}
      className="w-full"
    >
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
