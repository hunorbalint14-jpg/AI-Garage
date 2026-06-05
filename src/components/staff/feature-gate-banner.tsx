import Link from "next/link";
import { Lock } from "lucide-react";

// Server banner shown above a premium feature the current tier doesn't include
// (or whose billing has lapsed past grace). The action itself is also guarded
// server-side — this is the visible nudge to upgrade.
export function FeatureGateBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-amber-300/40 bg-amber-500/10 p-4 text-sm text-amber-700">
      <Lock className="h-4 w-4 shrink-0" />
      <span className="flex-1">{message}</span>
      <Link href="/staff/settings/billing" className="font-semibold underline underline-offset-2">
        Upgrade
      </Link>
    </div>
  );
}
