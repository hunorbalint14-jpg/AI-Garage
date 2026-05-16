import { cookies } from "next/headers";
import { ExitImpersonationButton } from "./exit-impersonation-button";

const STASH_COOKIE = "ai_impersonator_stash";

export async function ImpersonationBanner() {
  const store = await cookies();
  const stash = store.get(STASH_COOKIE)?.value;
  if (!stash) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 rounded-full border border-amber-400 bg-amber-500/95 px-4 py-2 shadow-2xl backdrop-blur">
      <span className="text-xs font-semibold text-amber-950">
        Impersonating session — your original login is preserved
      </span>
      <ExitImpersonationButton />
    </div>
  );
}
