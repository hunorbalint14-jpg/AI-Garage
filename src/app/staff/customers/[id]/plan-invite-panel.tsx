"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { sendPlanInvite, type InviteChannel } from "./plan-invite-actions";

export type InvitePlanOption = { id: string; name: string };

export function PlanInvitePanel({
  customerId,
  plans,
  hasEmail,
  hasPhone,
}: {
  customerId: string;
  plans: InvitePlanOption[];
  hasEmail: boolean;
  hasPhone: boolean;
}) {
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [email, setEmail] = useState(hasEmail);
  const [sms, setSms] = useState(!hasEmail && hasPhone);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; sent: { email: boolean; sms: boolean } } | null>(null);
  const [copied, setCopied] = useState(false);

  function send() {
    setError(null);
    setResult(null);
    setCopied(false);
    const channels: InviteChannel[] = [...(email ? ["email"] : []), ...(sms ? ["sms"] : [])] as InviteChannel[];
    if (channels.length === 0) return setError("Pick email or SMS.");
    if (!planId) return setError("Pick a plan.");
    start(async () => {
      const res = await sendPlanInvite(customerId, planId, channels);
      if ("error" in res) setError(res.error);
      else setResult(res);
    });
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
    } catch {
      // clipboard blocked — the link is visible in the field to copy manually
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-ws-border pt-4">
      <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ws-text-3">
        Invite to a plan
      </h3>

      {!hasEmail && !hasPhone ? (
        <p className="text-[12px] text-ws-text-3">Add an email or phone number to this customer to send an invite.</p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="invite-plan" className="text-[11px] text-ws-text-3">Plan</label>
            <select
              id="invite-plan"
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              disabled={pending}
              className="rounded-[8px] border border-ws-border bg-ws-page px-2 py-1.5 text-[13px] text-ws-text outline-none focus:border-ws-text-3"
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <label className={`mb-1.5 flex items-center gap-1.5 text-[13px] text-ws-text-2 ${hasEmail ? "" : "opacity-50"}`}>
            <input
              type="checkbox"
              checked={email}
              disabled={!hasEmail || pending}
              onChange={(e) => setEmail(e.target.checked)}
            />
            Email
          </label>
          <label className={`mb-1.5 flex items-center gap-1.5 text-[13px] text-ws-text-2 ${hasPhone ? "" : "opacity-50"}`}>
            <input
              type="checkbox"
              checked={sms}
              disabled={!hasPhone || pending}
              onChange={(e) => setSms(e.target.checked)}
            />
            SMS
          </label>
          <Button size="sm" variant="outline" onClick={send} loading={pending} className="mb-1">
            Send invite
          </Button>
        </div>
      )}

      {error && <p className="text-[12px] text-ws-red">{error}</p>}

      {result && (
        <div className="flex flex-col gap-2 text-[13px]">
          <p className="text-ws-green">
            ✓ Invite created{result.sent.email ? " · emailed" : ""}
            {result.sent.sms ? " · texted" : ""}.
          </p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={result.url}
              aria-label="Invite link"
              className="min-w-0 flex-1 rounded-[8px] border border-ws-border bg-ws-page px-2 py-1 text-[11px] text-ws-text-2"
            />
            <Button size="sm" variant="outline" onClick={copy} disabled={pending}>
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
