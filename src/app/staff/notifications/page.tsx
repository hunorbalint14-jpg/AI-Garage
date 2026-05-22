import Link from "next/link";
import { Bell } from "lucide-react";
import { requireStaffContext } from "@/lib/staff-context";
import { listRecentNotifications } from "@/lib/staff-notifications";
import { NotificationsList } from "./notifications-list";

export default async function NotificationsPage() {
  const ctx = await requireStaffContext();
  const notifications = await listRecentNotifications(ctx.location.id, 100);

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <div className="flex items-center gap-2">
        <Bell className="h-5 w-5" />
        <h1 className="text-2xl font-bold">Notifications</h1>
      </div>

      {notifications.length === 0 ? (
        <div className="rounded-lg border p-8 text-center">
          <p className="text-sm text-muted-foreground">No notifications yet.</p>
          <Link href="/staff" className="text-sm underline mt-2 inline-block">← Back to dashboard</Link>
        </div>
      ) : (
        <NotificationsList notifications={notifications} />
      )}
    </div>
  );
}
