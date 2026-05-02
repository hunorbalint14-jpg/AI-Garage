import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type StaffContext = {
  user: { id: string; email: string | undefined };
  membership: {
    garage_id: string;
    role: string;
    garage: { id: string; name: string; slug: string } | null;
  };
  supabase: Awaited<ReturnType<typeof createClient>>;
};

export async function getStaffContext(): Promise<StaffContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: membership } = (await supabase
    .from("garage_users")
    .select("garage_id, role, garage:garages(id, name, slug)")
    .eq("user_id", user.id)
    .maybeSingle()) as {
    data: StaffContext["membership"] | null;
  };

  if (!membership) return null;

  return {
    user: { id: user.id, email: user.email },
    membership,
    supabase,
  };
}

export async function requireStaffContext(): Promise<StaffContext> {
  const ctx = await getStaffContext();
  if (!ctx) redirect("/staff/login");
  return ctx;
}
