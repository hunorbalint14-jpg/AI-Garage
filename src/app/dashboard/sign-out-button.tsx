"use client";

import { useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export function CustomerSignOutButton() {
  const supabase = createClient();
  const [pending, startTransition] = useTransition();

  function handleSignOut() {
    startTransition(async () => {
      await supabase.auth.signOut();
      window.location.href = "/login";
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={handleSignOut}
    >
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
