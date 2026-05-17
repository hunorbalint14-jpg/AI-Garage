"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export type CampaignDetail = {
  subject: string;
  firstSentAt: string;
  lastSentAt: string;
  emailSent: number;
  smsSent: number;
  failed: number;
  delivered: number;
  opened: number;
  clicked: number;
  emailBody: string | null;
  smsBody: string | null;
  failures: { recipient: string; channel: string; reason: string }[];
};

function pct(num: number, denom: number) {
  if (!denom) return "—";
  return `${Math.round((num / denom) * 100)}%`;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CampaignHistory({ campaigns }: { campaigns: CampaignDetail[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="bg-muted/50 text-left">
          <tr>
            <th className="w-8 px-2 py-2" />
            <th className="px-4 py-2 font-medium">Date</th>
            <th className="px-4 py-2 font-medium">Subject</th>
            <th className="px-4 py-2 font-medium text-right">Sent</th>
            <th className="px-4 py-2 font-medium text-right">Delivered</th>
            <th className="px-4 py-2 font-medium text-right">Opened</th>
            <th className="px-4 py-2 font-medium text-right">Clicked</th>
            <th className="px-4 py-2 font-medium text-right">Failed</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c, idx) => {
            const sent = c.emailSent + c.smsSent;
            const openBase = c.delivered || c.emailSent;
            const isOpen = openIdx === idx;
            return (
              <Fragment key={`${c.subject}-${idx}`}>
                <tr
                  className="border-t cursor-pointer hover:bg-muted/30"
                  onClick={() => setOpenIdx(isOpen ? null : idx)}
                >
                  <td className="px-2 py-2 text-muted-foreground">
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </td>
                  <td
                    className="px-4 py-2 text-muted-foreground whitespace-nowrap"
                    title={formatDateTime(c.lastSentAt)}
                  >
                    {formatDateTime(c.lastSentAt)}
                  </td>
                  <td className="px-4 py-2 max-w-[260px] truncate" title={c.subject}>
                    {c.subject}
                  </td>
                  <td
                    className="px-4 py-2 text-right tabular-nums"
                    title={`${c.emailSent} email · ${c.smsSent} SMS`}
                  >
                    {sent || "—"}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {c.emailSent > 0 ? (
                      <span title={`${c.delivered}/${c.emailSent} confirmed delivered`}>
                        {c.delivered}{" "}
                        <span className="text-xs text-muted-foreground">
                          ({pct(c.delivered, c.emailSent)})
                        </span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {c.opened > 0 ? (
                      <span title={`${c.opened} opens of ${openBase}`}>
                        {c.opened}{" "}
                        <span className="text-xs text-muted-foreground">
                          ({pct(c.opened, openBase)})
                        </span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {c.clicked > 0 ? (
                      <span title={`${c.clicked} clicks of ${openBase}`}>
                        {c.clicked}{" "}
                        <span className="text-xs text-muted-foreground">
                          ({pct(c.clicked, openBase)})
                        </span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {c.failed > 0 ? (
                      <span className="text-red-600">{c.failed}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-t bg-muted/20">
                    <td />
                    <td colSpan={7} className="px-4 py-4">
                      <div className="flex flex-col gap-4">
                        <div className="grid grid-cols-1 gap-1 text-xs text-muted-foreground sm:grid-cols-3">
                          <div>
                            <span className="font-medium text-foreground">First sent:</span>{" "}
                            {formatDateTime(c.firstSentAt)}
                          </div>
                          <div>
                            <span className="font-medium text-foreground">Last sent:</span>{" "}
                            {formatDateTime(c.lastSentAt)}
                          </div>
                          <div>
                            <span className="font-medium text-foreground">Subject:</span>{" "}
                            {c.subject}
                          </div>
                        </div>

                        {c.emailBody && (
                          <div>
                            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              Email body
                            </p>
                            <pre className="whitespace-pre-wrap rounded-md border bg-background px-3 py-2 text-sm font-sans">
                              {c.emailBody}
                            </pre>
                          </div>
                        )}

                        {c.smsBody && (
                          <div>
                            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              SMS body
                            </p>
                            <pre className="whitespace-pre-wrap rounded-md border bg-background px-3 py-2 text-sm font-sans">
                              {c.smsBody}
                            </pre>
                          </div>
                        )}

                        {c.failures.length > 0 && (
                          <div>
                            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-red-700">
                              Failures ({c.failures.length})
                            </p>
                            <ul className="space-y-1 text-xs">
                              {c.failures.map((f, i) => (
                                <li key={i} className="text-red-700/90">
                                  <span className="font-mono">{f.recipient}</span>{" "}
                                  <span className="uppercase text-muted-foreground">({f.channel})</span> — {f.reason}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
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
