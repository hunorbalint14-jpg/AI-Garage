"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight, Mail, MessageSquare, Phone } from "lucide-react";

type Channel = "email" | "sms" | "whatsapp";

export type ReminderHistoryItem = {
  groupKey: string;
  type: string;
  subject: string;
  sentAt: string;
  vehicleRegistration: string | null;
  channels: {
    channel: Channel;
    status: "sent" | "failed" | "bounced";
    recipient: string | null;
    body: string | null;
    error: string | null;
    deliveredAt: string | null;
    openedAt: string | null;
    clickedAt: string | null;
  }[];
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ChannelIcon({ channel }: { channel: Channel }) {
  if (channel === "email") return <Mail className="h-4 w-4" />;
  if (channel === "sms") return <Phone className="h-4 w-4" />;
  return <MessageSquare className="h-4 w-4" />;
}

function ChannelBadge({
  channel,
  status,
}: {
  channel: Channel;
  status: "sent" | "failed" | "bounced";
}) {
  const ok = status === "sent";
  const label = channel === "sms" ? "SMS" : channel === "whatsapp" ? "WhatsApp" : "Email";
  return (
    <span
      title={`${label} — ${status}`}
      className={
        "inline-flex h-7 w-7 items-center justify-center rounded-full border " +
        (ok
          ? "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300"
          : "border-red-500/40 bg-red-500/10 text-red-600")
      }
    >
      <ChannelIcon channel={channel} />
    </span>
  );
}

export function ReminderHistory({ items }: { items: ReminderHistoryItem[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-muted/50 text-left">
          <tr>
            <th className="w-8 px-2 py-2" />
            <th className="px-4 py-2 font-medium">Date</th>
            <th className="px-4 py-2 font-medium">Type</th>
            <th className="px-4 py-2 font-medium">Subject</th>
            <th className="px-4 py-2 font-medium">Channels</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const isOpen = openKey === item.groupKey;
            return (
              <Fragment key={item.groupKey}>
                <tr
                  className="border-t cursor-pointer hover:bg-muted/30"
                  onClick={() => setOpenKey(isOpen ? null : item.groupKey)}
                >
                  <td className="px-2 py-2 text-muted-foreground">
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                    {formatDateTime(item.sentAt)}
                  </td>
                  <td className="px-4 py-2 capitalize">{item.type}</td>
                  <td className="px-4 py-2 max-w-[280px] truncate" title={item.subject}>
                    {item.subject}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1.5">
                      {item.channels.map((c) => (
                        <ChannelBadge key={c.channel} channel={c.channel} status={c.status} />
                      ))}
                    </div>
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-t bg-muted/20">
                    <td />
                    <td colSpan={4} className="px-4 py-4">
                      <div className="flex flex-col gap-4">
                        {item.channels.map((c) => {
                          const label =
                            c.channel === "sms"
                              ? "SMS"
                              : c.channel === "whatsapp"
                              ? "WhatsApp"
                              : "Email";
                          return (
                            <div
                              key={c.channel}
                              className="rounded-md border bg-background"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 text-xs">
                                <div className="flex items-center gap-2">
                                  <ChannelBadge channel={c.channel} status={c.status} />
                                  <span className="font-medium">{label}</span>
                                  {c.recipient && (
                                    <span className="font-mono text-muted-foreground">
                                      → {c.recipient}
                                    </span>
                                  )}
                                </div>
                                <div className="flex gap-3 text-muted-foreground">
                                  {c.deliveredAt && (
                                    <span title={`Delivered ${formatDateTime(c.deliveredAt)}`}>
                                      ✓ Delivered
                                    </span>
                                  )}
                                  {c.openedAt && (
                                    <span title={`Opened ${formatDateTime(c.openedAt)}`}>
                                      ✓ Opened
                                    </span>
                                  )}
                                  {c.clickedAt && (
                                    <span title={`Clicked ${formatDateTime(c.clickedAt)}`}>
                                      ✓ Clicked
                                    </span>
                                  )}
                                </div>
                              </div>
                              {c.error && (
                                <p className="border-b px-3 py-2 text-xs text-red-700">
                                  {c.error}
                                </p>
                              )}
                              {c.body && (
                                <pre className="whitespace-pre-wrap px-3 py-2 text-sm font-sans">
                                  {c.body}
                                </pre>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
