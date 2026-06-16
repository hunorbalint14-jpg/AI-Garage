import { Bell } from "lucide-react";
import { listRecentNotifications, unreadNotificationCount } from "@/lib/staff-notifications";
import { NotificationsBell } from "./notifications-bell";

// Server wrapper that fetches the bell's data, so the staff layout can stream it
// behind a Suspense boundary — the nav chrome paints before these two queries
// resolve. Used only when the `streaming_dashboard` flag is on; otherwise the
// layout fetches the data up front and renders <NotificationsBell> directly.
export async function StreamedNotificationsBell({ locationId }: { locationId: string }) {
  const [unreadCount, recent] = await Promise.all([
    unreadNotificationCount(locationId),
    listRecentNotifications(locationId, 8),
  ]);
  return <NotificationsBell unreadCount={unreadCount} recent={recent} />;
}

// Static placeholder shown while the bell streams in: same position and shape,
// no badge, non-interactive.
export function NotificationsBellFallback() {
  return (
    <div className="fixed top-3 right-4 z-30">
      <div
        className="grid h-10 w-10 place-items-center rounded-full border border-[#2a2f37] bg-[#15181d] text-[#e6e8eb]"
        aria-hidden="true"
      >
        <Bell className="h-4 w-4 opacity-50" />
      </div>
    </div>
  );
}
