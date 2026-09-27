"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyUnsubscribe } from "@/lib/unsubscribe";

// Human unsubscribe (#596 PR 5): the landing page's buttons post here. A
// button press is required on purpose — mail scanners that pre-fetch links
// must never be able to unsubscribe a customer by visiting one.
export async function unsubscribeAction(formData: FormData): Promise<void> {
  const token = String(formData.get("u") ?? "");
  const choice = String(formData.get("channel") ?? "all");
  const channels = {
    email: choice === "email" || choice === "all",
    sms: choice === "sms" || choice === "all",
  };

  await applyUnsubscribe(createAdminClient(), token, channels, "unsubscribe_page");
  redirect(`/unsubscribe?u=${encodeURIComponent(token)}&done=${encodeURIComponent(choice)}`);
}
