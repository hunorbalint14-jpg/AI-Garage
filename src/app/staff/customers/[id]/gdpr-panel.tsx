"use client";

import { useState, useTransition } from "react";
import { Shield, Download, AlertTriangle, Trash2 } from "lucide-react";
import { updateConsent, anonymizeCustomer, exportCustomerData, deleteCustomerHard } from "./gdpr-actions";
import { Button } from "@/components/ui/button";

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

  function handleHardDelete() {
    if (!confirm(`HARD DELETE ${customerName}? This removes all customer records permanently (only allowed if no invoices exist).`)) return;
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
      <section className="rounded-lg border p-4 bg-muted/30">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          <Shield className="h-4 w-4" /> Privacy & data (GDPR)
        </h2>
        <p className="text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          Customer data anonymized on {new Date(anonymizedAt).toLocaleDateString("en-GB")}. PII removed; financial records retained.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        <Shield className="h-4 w-4" /> Privacy & data (GDPR)
      </h2>

      <div className="flex flex-col gap-3 mb-4">
        <p className="text-xs text-muted-foreground">
          Marketing consent. Transactional messages (booking confirmations, MOT reminders) are always sent under legitimate interest.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={email}
            onChange={(e) => setEmail(e.target.checked)}
            className="h-4 w-4 rounded border"
          />
          Email marketing consent
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={sms}
            onChange={(e) => setSms(e.target.checked)}
            className="h-4 w-4 rounded border"
          />
          SMS marketing consent
        </label>
        {consentUpdatedAt && (
          <p className="text-xs text-muted-foreground">
            Last updated: {new Date(consentUpdatedAt).toLocaleString("en-GB")}
          </p>
        )}
        <Button onClick={handleSaveConsent} loading={pending} className="self-start">
          {saved ? "Saved" : "Save consent"}
        </Button>
      </div>

      <div className="border-t pt-4 flex flex-col gap-2">
        <p className="text-xs text-muted-foreground mb-1">Data subject rights:</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={handleExport} disabled={pending}>
            <Download className="h-4 w-4 mr-1.5" />
            Export data
          </Button>
          {canErase && (
            <Button variant="outline" onClick={handleAnonymize} disabled={pending} className="text-amber-700 dark:text-amber-400 border-amber-300">
              <AlertTriangle className="h-4 w-4 mr-1.5" />
              Erase PII (anonymize)
            </Button>
          )}
          {isOwner && (
            <Button variant="destructive" onClick={handleHardDelete} disabled={pending}>
              <Trash2 className="h-4 w-4 mr-1.5" />
              Hard delete
            </Button>
          )}
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </section>
  );
}
