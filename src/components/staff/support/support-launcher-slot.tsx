import { Suspense } from "react";
import { LifeBuoy } from "lucide-react";
import {
  countUnreadTicketNotifications,
  latestUnreadTicketReply,
} from "@/lib/staff-notifications";
import { countLiveOrgTickets } from "@/lib/support-tickets";
import { SupportLauncher, type SupportLauncherProps } from "./support-launcher";

type StaticProps = Omit<SupportLauncherProps, "openTicketCount" | "unreadReplyCount" | "latestUnread">;

// Server half of the launcher: fetches the three notification/count queries.
// Used directly in the non-streaming layout branch and behind Suspense in the
// streaming one (same split as the notifications bell).
export async function StreamedSupportLauncher({
  userId,
  organizationId,
  staticProps,
}: {
  userId: string;
  organizationId: string;
  staticProps: StaticProps;
}) {
  const [unreadReplyCount, latestUnread, openTicketCount] = await Promise.all([
    countUnreadTicketNotifications(userId),
    latestUnreadTicketReply(userId),
    countLiveOrgTickets(organizationId),
  ]);
  return (
    <SupportLauncher
      {...staticProps}
      openTicketCount={openTicketCount}
      unreadReplyCount={unreadReplyCount}
      latestUnread={latestUnread}
    />
  );
}

// Non-interactive placeholder while the streamed launcher resolves — mirrors
// NotificationsBellFallback so the cluster doesn't jump.
export function SupportLauncherFallback() {
  return (
    <div
      className="grid h-10 w-10 place-items-center rounded-full border border-[#2a2f37] bg-[#15181d] text-[#5a6170]"
      aria-hidden
    >
      <LifeBuoy className="h-4 w-4" />
    </div>
  );
}

// Streaming wrapper the layout mounts: Suspense + fallback in one place.
export function SupportLauncherSlot(props: {
  userId: string;
  organizationId: string;
  staticProps: StaticProps;
}) {
  return (
    <Suspense fallback={<SupportLauncherFallback />}>
      <StreamedSupportLauncher {...props} />
    </Suspense>
  );
}
