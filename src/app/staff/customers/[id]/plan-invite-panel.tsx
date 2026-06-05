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
    <section className="rounded-lg border p-4 flex flex-col gap-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Invite to a plan</h2>

      {!hasEmail && !hasPhone ? (
        <p className="text-xs text-muted-foreground">Add an email or phone number to this customer to send an invite.</p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="invite-plan" className="text-xs text-muted-foreground">Plan</label>
            <select
              id="invite-plan"
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              disabled={pending}
              className="rounded-md border bg-transparent px-3 py-2 text-sm"
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <label className={`flex items-center gap-1.5 text-sm ${hasEmail ? "" : "opacity-50"}`}>
            <input
              type="checkbox"
              checked={email}
              disabled={!hasEmail || pending}
              onChange={(e) => setEmail(e.target.checked)}
            />
            Email
          </label>
          <label className={`flex items-center gap-1.5 text-sm ${hasPhone ? "" : "opacity-50"}`}>
            <input
              type="checkbox"
              checked={sms}
              disabled={!hasPhone || pending}
              onChange={(e) => setSms(e.target.checked)}
            />
            SMS
          </label>
          <Button onClick={send} loading={pending}>
            Send invite
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {result && (
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-green-700">
            Invite created{result.sent.email ? " · emailed" : ""}
            {result.sent.sms ? " · texted" : ""}.
          </p>
          <div className="flex items-center gap-2">
            <input readOnly value={result.url} className="flex-1 rounded-md border bg-muted/30 px-2 py-1 text-xs" />
            <Button variant="outline" onClick={copy} disabled={pending}>
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
