"use client";

import { useState, useTransition } from "react";
import { Download, AlertTriangle, Trash2 } from "lucide-react";
import { updateConsent, anonymizeCustomer, exportCustomerData, deleteCustomerHard } from "./gdpr-actions";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-provider";

type Props = {
  customerId: string;
  customerName: string;
  emailConsent: boolean;
  smsConsent: boolean;
  consentUpdatedAt: string | null;
  anonymizedAt: string | null;
  canErase: boolean;
  isOwner: boolean;
};

export function GdprPanel({
  customerId,
  customerName,
  emailConsent,
  smsConsent,
  consentUpdatedAt,
  anonymizedAt,
  canErase,
  isOwner,
}: Props) {
  const confirm = useConfirm();
  const [email, setEmail] = useState(emailConsent);
  const [sms, setSms] = useState(smsConsent);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleSaveConsent() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await updateConsent(customerId, email, sms);
      if ("error" in res) setError(res.error);
      else { setSaved(true); setTimeout(() => setSaved(false), 2000); }
    });
  }

  function handleExport() {
    setError(null);
    startTransition(async () => {
      const res = await exportCustomerData(customerId);
      if ("error" in res) { setError(res.error); return; }
      const blob = new Blob([res.data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `customer-${customerId.slice(0, 8)}-export.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  function handleAnonymize() {
    const reason = prompt(`This will permanently remove PII (name, email, phone) for ${customerName}. Financial records (invoices) are kept for tax compliance.\n\nReason (required for audit log):`);
    if (!reason?.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await anonymizeCustomer(customerId, reason);
      if ("error" in res) setError(res.error);
    });
  }

  async function handleHardDelete() {
    const ok = await confirm({
      title: `Hard-delete ${customerName}?`,
      description:
        "Removes every record for this customer permanently — vehicles, bookings, reminders, the lot. Only allowed when no invoices exist. This cannot be undone.",
      confirmLabel: "Hard delete",
      destructive: true,
    });
    if (!ok) return;
    const reason = prompt("Reason (required for audit log):");
    if (!reason?.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteCustomerHard(customerId, reason);
      if ("error" in res) setError(res.error);
    });
  }

  if (anonymizedAt) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-ws-amber">
        <AlertTriangle className="h-4 w-4 flex-none" />
        Customer data anonymized on {new Date(anonymizedAt).toLocaleDateString("en-GB")}. PII removed; financial
        records retained.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-2 text-[13px] text-ws-text-2">
        <input
          type="checkbox"
          checked={email}
          onChange={(e) => setEmail(e.target.checked)}
          className="h-4 w-4 accent-current"
        />
        Email marketing consent
      </label>
      <label className="mb-1 flex items-center gap-2 text-[13px] text-ws-text-2">
        <input
          type="checkbox"
          checked={sms}
          onChange={(e) => setSms(e.target.checked)}
          className="h-4 w-4 accent-current"
        />
        SMS marketing consent
      </label>

      <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-ws-text-3">
        {consentUpdatedAt
          ? `CONSENT UPDATED ${new Date(consentUpdatedAt).toLocaleDateString("en-GB")}`
          : "CONSENT NEVER RECORDED"}
      </p>
      <p className="text-[11.5px] text-ws-text-3">
        Marketing only. Transactional messages (booking confirmations, MOT reminders) always send under
        legitimate interest.
      </p>

      <Button size="sm" variant="outline" onClick={handleSaveConsent} loading={pending} className="mt-1 self-start">
        {saved ? "Saved" : "Save consent"}
      </Button>

      <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-ws-border pt-3 text-[12.5px]">
        <button
          type="button"
          onClick={handleExport}
          disabled={pending}
          className="inline-flex items-center gap-1.5 text-ws-text-2 underline underline-offset-2 hover:text-ws-text disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" />
          Export data
        </button>
        {canErase && (
          <button
            type="button"
            onClick={handleAnonymize}
            disabled={pending}
            className="inline-flex items-center gap-1.5 text-amber-400 underline underline-offset-2 hover:brightness-110 disabled:opacity-50"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            Erase PII
          </button>
        )}
        {isOwner && (
          <button
            type="button"
            onClick={handleHardDelete}
            disabled={pending}
            className="inline-flex items-center gap-1.5 text-ws-red underline underline-offset-2 hover:brightness-110 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Hard delete
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-[12px] text-ws-red">{error}</p>}
    </div>
  );
}
