"use client";

import { Fragment, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AiAssistMenu } from "@/components/staff/ai-assist-menu";
import { approveAndSendTyreRecommendation } from "./actions";
import { TyreCareRowActions } from "./row-actions";

// Tyre-care review queue list (#596 PR 5). Compose-first: "Review & send"
// opens an inline composer pre-filled with the standard wording (a plain
// template that states the evidence — not AI). Staff edit freely; the assist
// menu is the only way AI touches the text. Send stays blocked while any
// ticked channel has no message, and channels without consent can't be
// ticked at all — nothing is ever silently skipped.

const TEXTAREA_CLASS =
  "w-full rounded-md border border-black/20 dark:border-white/25 bg-transparent px-3 py-2 text-sm shadow-sm resize-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

export type QueueItem = {
  id: string;
  status: string;
  serviceLabel: string;
  confidence: "high" | "low";
  reason: string;
  dismissedReason: string | null;
  ageLabel: string;
  eventLabel: string | null;
  customerName: string;
  customerHref: string | null;
  registration: string;
  makeModel: string;
  vehicleHref: string | null;
  needsSetup: boolean;
  motInDays: number | null;
  email: { available: boolean; blocked: string | null };
  sms: { available: boolean; blocked: string | null };
  cap: { allowed: boolean; reason: string | null };
  draft: { subject: string; email: string; sms: string };
};

type Composer = {
  id: string;
  subject: string;
  emailText: string;
  smsText: string;
  email: boolean;
  sms: boolean;
  sending: boolean;
  error: string | null;
};

export function TyreCareList({ items, emptyText }: { items: QueueItem[]; emptyText: string }) {
  const router = useRouter();
  const [composer, setComposer] = useState<Composer | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{emptyText}</div>
    );
  }

  function open(item: QueueItem) {
    setNotice(null);
    setComposer({
      id: item.id,
      subject: item.draft.subject,
      emailText: item.draft.email,
      smsText: item.draft.sms,
      email: item.email.available,
      sms: !item.email.available && item.sms.available,
      sending: false,
      error: null,
    });
  }

  function send(item: QueueItem) {
    if (!composer || composer.sending) return;
    const c = composer;
    setComposer({ ...c, sending: true, error: null });
    startTransition(async () => {
      const result = await approveAndSendTyreRecommendation(
        c.id,
        { subject: c.subject, emailText: c.emailText, smsText: c.smsText },
        { email: c.email, sms: c.sms },
      );
      if ("error" in result) {
        setComposer((prev) => (prev && prev.id === c.id ? { ...prev, sending: false, error: result.error } : prev));
        return;
      }
      setComposer(null);
      setNotice(`Sent to ${item.customerName} — ${result.channels.join(", ")}.`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {notice && (
        <p className="rounded-md border border-ws-green-border bg-ws-green-bg px-3 py-2 text-sm text-ws-green">{notice}</p>
      )}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Vehicle</th>
              <th className="px-4 py-2 font-medium">Customer</th>
              <th className="px-4 py-2 font-medium">Recommendation</th>
              <th className="px-4 py-2 font-medium">Why</th>
              <th className="px-4 py-2 font-medium">Raised</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const isOpen = composer?.id === item.id;
              const sendable =
                item.status === "pending_review" && !item.needsSetup && item.cap.allowed &&
                (item.email.available || item.sms.available);
              return (
                <Fragment key={item.id}>
                  <tr className="border-t align-top">
                    <td className="px-4 py-3">
                      {item.vehicleHref ? (
                        <Link href={item.vehicleHref} className="font-mono font-semibold underline-offset-2 hover:underline">
                          {item.registration}
                        </Link>
                      ) : (
                        <span className="font-mono">{item.registration}</span>
                      )}
                      <div className="text-xs text-muted-foreground">{item.makeModel || " "}</div>
                    </td>
                    <td className="px-4 py-3">
                      {item.customerHref ? (
                        <Link href={item.customerHref} className="underline-offset-2 hover:underline">
                          {item.customerName}
                        </Link>
                      ) : (
                        item.customerName
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium capitalize">{item.serviceLabel}</div>
                      <span
                        className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs ${
                          item.confidence === "high" ? "bg-ws-green-bg text-ws-green" : "bg-ws-amber-bg text-ws-amber"
                        }`}
                      >
                        {item.confidence === "high" ? "Measured evidence" : "Mileage estimate"}
                      </span>
                    </td>
                    <td className="px-4 py-3 max-w-md">
                      <p className="text-sm">{item.reason}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {item.status === "pending_review" && item.needsSetup && item.vehicleHref && (
                          <Link
                            href={item.vehicleHref}
                            className="rounded border border-ws-amber-border bg-ws-amber-bg px-1.5 py-0.5 text-xs text-ws-amber hover:underline"
                          >
                            Wheel setup not confirmed
                          </Link>
                        )}
                        {item.status === "pending_review" && item.motInDays !== null && (
                          <span className="rounded border border-ws-blue-border bg-ws-blue-bg px-1.5 py-0.5 text-xs text-ws-blue">
                            MOT due in {item.motInDays} day{item.motInDays === 1 ? "" : "s"}
                          </span>
                        )}
                        {item.status === "pending_review" && !item.cap.allowed && item.cap.reason && (
                          <span className="rounded border border-black/10 bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                            {item.cap.reason}
                          </span>
                        )}
                      </div>
                      {item.eventLabel && <p className="mt-1 text-xs text-muted-foreground">{item.eventLabel}</p>}
                      {item.status === "dismissed" && item.dismissedReason && (
                        <p className="mt-1 text-xs text-muted-foreground">Dismissed: {item.dismissedReason}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{item.ageLabel}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-col items-end gap-1.5">
                        {item.status === "pending_review" && !isOpen && (
                          <Button size="sm" onClick={() => open(item)} disabled={!sendable}>
                            Review &amp; send
                          </Button>
                        )}
                        {!isOpen && <TyreCareRowActions id={item.id} status={item.status} />}
                      </div>
                    </td>
                  </tr>
                  {isOpen && composer && (
                    <tr className="bg-muted/20">
                      <td colSpan={6} className="px-4 py-4">
                        <div className="mx-auto flex max-w-3xl flex-col gap-3">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium">
                              Message to {item.customerName} about {item.registration}
                            </p>
                            <Button size="sm" variant="ghost" onClick={() => setComposer(null)} disabled={composer.sending}>
                              Close
                            </Button>
                          </div>
                          {composer.error && <p className="text-sm text-ws-red">{composer.error}</p>}

                          <label className="text-xs font-medium text-muted-foreground">
                            Subject (email)
                            <input
                              className={`${TEXTAREA_CLASS} mt-1`}
                              value={composer.subject}
                              onChange={(e) => setComposer({ ...composer, subject: e.target.value })}
                              disabled={composer.sending}
                            />
                          </label>

                          <div className="text-xs font-medium text-muted-foreground">
                            <div className="flex items-center justify-between gap-2">
                              <span>Email</span>
                              <AiAssistMenu
                                channel="email"
                                getText={() => composer.emailText}
                                onText={(t) => setComposer((prev) => (prev ? { ...prev, emailText: t } : prev))}
                                disabled={composer.sending}
                              />
                            </div>
                            <textarea
                              className={`${TEXTAREA_CLASS} mt-1`}
                              rows={7}
                              value={composer.emailText}
                              onChange={(e) => setComposer({ ...composer, emailText: e.target.value })}
                              disabled={composer.sending}
                            />
                            <p className="mt-1 font-normal">
                              A “Book it in” button, your branch details and an unsubscribe link are added automatically.
                            </p>
                          </div>

                          <div className="text-xs font-medium text-muted-foreground">
                            <div className="flex items-center justify-between gap-2">
                              <span>Text message</span>
                              <AiAssistMenu
                                channel="sms"
                                getText={() => composer.smsText}
                                onText={(t) => setComposer((prev) => (prev ? { ...prev, smsText: t } : prev))}
                                disabled={composer.sending}
                              />
                            </div>
                            <textarea
                              className={`${TEXTAREA_CLASS} mt-1`}
                              rows={3}
                              value={composer.smsText}
                              onChange={(e) => setComposer({ ...composer, smsText: e.target.value })}
                              disabled={composer.sending}
                            />
                            <p className="mt-1 font-normal">
                              The booking link, branch name and an opt-out link are added automatically.
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-4 text-sm">
                            {(["email", "sms"] as const).map((ch) => {
                              const channel = item[ch];
                              return (
                                <label key={ch} className="flex items-center gap-1.5" title={channel.blocked ?? undefined}>
                                  <input
                                    type="checkbox"
                                    checked={composer[ch]}
                                    onChange={() => setComposer({ ...composer, [ch]: !composer[ch] })}
                                    disabled={composer.sending || !channel.available}
                                  />
                                  {ch === "sms" ? "SMS" : "Email"}
                                  {channel.blocked && (
                                    <span className="text-xs text-muted-foreground">({channel.blocked})</span>
                                  )}
                                </label>
                              );
                            })}
                            <span className="ml-auto">
                              <Button
                                size="sm"
                                onClick={() => send(item)}
                                loading={composer.sending}
                                disabled={
                                  (!composer.email && !composer.sms) ||
                                  // Every ticked channel needs its message — never silently skip one.
                                  (composer.email && !composer.emailText.trim()) ||
                                  (composer.sms && !composer.smsText.trim())
                                }
                              >
                                Approve &amp; send
                              </Button>
                            </span>
                          </div>
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
    </div>
  );
}
