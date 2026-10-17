"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AigSpinner } from "@/components/ui/aig-spinner";
import { useConfirm } from "@/components/confirm-provider";
import { COURTESY_TRIAL_MONTHS, courtesyTrialEnd } from "@/lib/courtesy-trial";
import { grantCourtesyTrial, endCourtesyTrial } from "./trial-actions";

const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// Grant / replace / end a no-card courtesy trial for one garage. The server
// action re-checks everything; this just collects tier + length.
export function CourtesyTrial({
  orgId,
  planName,
  trialEnd,
  subscriptionStatus,
  billed,
  nowIso,
}: {
  orgId: string;
  planName: string;
  trialEnd: string | null;
  subscriptionStatus: string | null;
  billed: boolean;
  nowIso: string;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [tier, setTier] = useState<"pro" | "growth">("growth");
  const [months, setMonths] = useState<number>(3);
  const [pending, setPending] = useState<"grant" | "end" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Server clock, so the rendered preview matches between SSR and hydration.
  const now = new Date(nowIso);
  const live = !!trialEnd && new Date(trialEnd) > now;
  const preview = courtesyTrialEnd(now, months);

  async function run(kind: "grant" | "end") {
    if (
      kind === "end" &&
      !(await confirm({
        title: "End this trial now?",
        description:
          "Premium features switch off immediately and the platform fee returns to Starter's 2%. Jobs, invoices and data are untouched.",
        confirmLabel: "End trial",
        destructive: true,
      }))
    ) {
      return;
    }
    setPending(kind);
    setMsg(null);
    const fd = new FormData();
    fd.set("orgId", orgId);
    fd.set("tier", tier);
    fd.set("months", String(months));
    const result = kind === "grant" ? await grantCourtesyTrial(fd) : await endCourtesyTrial(fd);
    setPending(null);
    if ("error" in result) {
      setMsg({ ok: false, text: result.error });
      return;
    }
    setMsg({
      ok: true,
      text: kind === "grant" ? `Trial live until ${fmtDate(result.trialEnd!)}.` : "Trial ended.",
    });
    router.refresh();
  }

  const selectCls =
    "rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white focus:border-white/30 focus:outline-none";
  const btnCls =
    "inline-flex items-center gap-2 rounded-lg border border-[#2a2f37] px-3 py-1.5 text-xs font-semibold text-[#e6e8eb] transition-colors hover:bg-white/[0.04] disabled:opacity-50";

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[#23272f] bg-[#15181d] p-3">
      <p className="text-xs text-[#9aa1ad]">
        {live ? (
          <>
            <span className="font-semibold text-[#7aa2ff]">{planName} trial</span> live until{" "}
            <span className="text-white">{fmtDate(trialEnd!)}</span>. No card on file — when it ends the garage drops
            to Starter features and the 2% fee. Nothing is charged.
          </>
        ) : trialEnd ? (
          <>Last trial ended {fmtDate(trialEnd)}.</>
        ) : (
          <>No trial. Grant one to unlock a paid tier with no card and no commitment.</>
        )}
      </p>

      {billed ? (
        <p className="rounded-lg border border-[#4a3a13] bg-[#2a2110] px-3 py-2 text-xs text-[#e8c97a]">
          This garage has a Stripe subscription ({subscriptionStatus}). Trials can&apos;t be granted on top of one —
          change their plan in Stripe instead.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Trial tier" value={tier} onChange={(e) => setTier(e.target.value as "pro" | "growth")} className={selectCls}>
            <option value="growth">Growth (all features)</option>
            <option value="pro">Pro</option>
          </select>
          <select aria-label="Trial length" value={months} onChange={(e) => setMonths(Number(e.target.value))} className={selectCls}>
            {COURTESY_TRIAL_MONTHS.map((m) => (
              <option key={m} value={m}>
                {m} {m === 1 ? "month" : "months"}
              </option>
            ))}
          </select>
          <button type="button" disabled={pending !== null} onClick={() => run("grant")} className={btnCls}>
            {pending === "grant" && <AigSpinner />}
            {live ? "Replace trial" : "Grant trial"}
          </button>
          {live && (
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => run("end")}
              className={`${btnCls} border-[#5a2a2a] text-[#ff9b9b] hover:bg-red-500/10`}
            >
              {pending === "end" && <AigSpinner />}
              End trial now
            </button>
          )}
          <span className="text-xs text-[#5a6170]">ends {fmtDate(preview)}</span>
        </div>
      )}

      {msg && <span className={`text-xs ${msg.ok ? "text-[#5fdd9d]" : "text-red-400"}`}>{msg.text}</span>}
    </div>
  );
}
