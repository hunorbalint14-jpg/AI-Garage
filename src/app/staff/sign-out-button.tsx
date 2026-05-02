"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const router = useRouter();
  const supabase = createClient();
  const [pending, startTransition] = useTransition();

  function handleSignOut() {
    startTransition(async () => {
      await supabase.auth.signOut();
      router.push("/staff/login");
      router.refresh();
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
