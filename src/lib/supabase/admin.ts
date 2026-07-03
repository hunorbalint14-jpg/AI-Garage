import "server-only";
import { createClient } from "@supabase/supabase-js";

// Service-role client — bypasses RLS. Never import into client code — the
// server-only marker turns any accidental client import into a build error
// (type-only imports stay fine; they're erased before bundling).
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
