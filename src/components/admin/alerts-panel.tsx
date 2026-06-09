"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AlertRuleView } from "@/lib/platform/alerts";
import { setAlertRuleEnabled } from "@/app/admin/health/alert-actions";

const SEV_BADGE: Record<string, string> = {
  "SEV-1": "text-[#ff7b7b] bg-[#3a1a1a] border-[#5a2424]",
  "SEV-2": "text-[#ff7b7b] bg-[#3a1a1a] border-[#5a2424]",
  "SEV-3": "text-[#f5c451] bg-[#2e2410] border-[#5a4a1f]",
  "SEV-4": "text-[#7aa2ff] bg-[#1c2740] border-[#2c3c63]",
};

function RuleRow({ rule }: { rule: AlertRuleView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      await setAlertRuleEnabled(rule.id, !rule.enabled);
      router.refresh();
    });
  }

  return (
    <tr className={`border-t border-[#23272f] ${rule.firing ? "bg-gradient-to-r from-[#3a1a1a] to-transparent" : ""}`}>
      <td className="px-3 py-2">
        <div className="font-medium text-white">{rule.name}</div>
        <div className="font-mono text-[11px] text-[#5a6170]">
          {rule.metric} {rule.operator} {rule.threshold} · {rule.window_secs}s
        </div>
      </td>
      <td className="px-3 py-2 text-xs text-[#9aa1ad]">{rule.source}</td>
      <td className="px-3 py-2">
        <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold ${SEV_BADGE[rule.severity]}`}>{rule.severity}</span>
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {(rule.channels ?? []).map((c) => (
            <span key={c} className="rounded border border-[#2a2f37] bg-[#171b21] px-1.5 py-0.5 font-mono text-[10px] text-[#9aa1ad]">
              {c}
            </span>
          ))}
          {rule.auto_declare && <span className="rounded border border-[#5a2424] bg-[#3a1a1a] px-1.5 py-0.5 font-mono text-[10px] text-[#ff7b7b]">auto-declare</span>}
        </div>
      </td>
      <td className="px-3 py-2 text-center">
        {rule.firing ? <span className="font-mono text-[11px] font-semibold text-[#ff7b7b]">● firing</span> : <span className="text-[11px] text-[#5a6170]">—</span>}
      </td>
      <td className="px-3 py-2 text-right">
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          role="switch"
          aria-checked={rule.enabled}
          className={`relative h-5 w-9 rounded-full border transition-colors disabled:opacity-50 ${
            rule.enabled ? "border-[#22c55e] bg-[#22c55e]/30" : "border-[#2a2f37] bg-[#171b21]"
          }`}
        >
          <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${rule.enabled ? "left-[18px] bg-[#22c55e]" : "left-0.5 bg-[#9aa1ad]"}`} />
        </button>
      </td>
    </tr>
  );
}

export function AlertsPanel({ rules }: { rules: AlertRuleView[] }) {
  const firing = rules.filter((r) => r.firing && r.enabled).length;
  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <h2 className="text-sm font-semibold">Alert rules</h2>
        {firing > 0 && <span className="rounded border border-[#5a2424] bg-[#3a1a1a] px-2 py-0.5 font-mono text-[11px] text-[#ff7b7b]">{firing} firing</span>}
      </div>
      <div className="overflow-x-auto rounded-xl border border-[#23272f]">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-[#15181d] text-xs text-[#9aa1ad]">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Rule</th>
              <th className="px-3 py-2 text-left font-medium">Source</th>
              <th className="px-3 py-2 text-left font-medium">Sev</th>
              <th className="px-3 py-2 text-left font-medium">Channels</th>
              <th className="px-3 py-2 text-center font-medium">State</th>
              <th className="px-3 py-2 text-right font-medium">Enabled</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <RuleRow key={r.id} rule={r} />
            ))}
            {rules.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-sm text-[#5a6170]">
                  No alert rules. Apply the seed migration.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-[#5a6170]">
        Synthetic rules evaluate every uptime run. Sentry/Stripe/Supabase rules stay dormant until those adapters land.
      </p>
    </div>
  );
}
