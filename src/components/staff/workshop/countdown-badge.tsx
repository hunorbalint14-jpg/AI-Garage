import { WorkshopBadge } from "./badge";

// Deadline countdown (UX review §1f): "{n}d left" — red inside a day,
// amber inside three, plain mono otherwise. Reusable anywhere a row has an
// expiry (quotes table, dashboard attention queue, …).

export function dueDays(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export function CountdownBadge({ expiresAt }: { expiresAt: string | null }) {
  const days = dueDays(expiresAt);
  if (days === null) return <span className="font-mono text-[10px] text-ws-text-3">—</span>;
  if (days < 0) return <WorkshopBadge tone="red">{Math.abs(days)}d over</WorkshopBadge>;
  if (days <= 1) return <WorkshopBadge tone="red">{days}d left</WorkshopBadge>;
  if (days <= 3) return <WorkshopBadge tone="amber">{days}d left</WorkshopBadge>;
  return <span className="font-mono text-[10px] font-semibold text-ws-text-2">{days}d left</span>;
}
