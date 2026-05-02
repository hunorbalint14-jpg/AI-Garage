import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function StaffDashboard() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/staff/login");

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="text-muted-foreground">
        Welcome back. This is where MOT/service stats and recent activity will
        appear.
      </p>
    </div>
  );
}
