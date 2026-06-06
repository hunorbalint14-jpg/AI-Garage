"use client";

import { useState, useTransition } from "react";
import { AigSpinner } from "@/components/ui/aig-spinner";
import { Check } from "lucide-react";
import { updateContactPreferences } from "./actions";

function Toggle({
  checked,
  onChange,
  label,
  hint,
  orgColor,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
  orgColor: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className="flex w-full items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition-colors hover:bg-white/[0.05] disabled:opacity-50"
    >
      <div>
        <p className="font-semibold">{label}</p>
        <p className="mt-0.5 text-xs text-gray-400">{hint}</p>
      </div>
      <span
        className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors"
        style={{ backgroundColor: checked ? orgColor : "rgba(255,255,255,0.15)" }}
      >
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
      </span>
    </button>
  );
}

export function ContactPrefsForm({
  initialEmail,
  initialSms,
  hasPhone,
  orgColor,
}: {
  initialEmail: boolean;
  initialSms: boolean;
  hasPhone: boolean;
  orgColor: string;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [sms, setSms] = useState(initialSms);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = email !== initialEmail || sms !== initialSms;

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await updateContactPreferences(email, sms);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setSaved(true);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <Toggle
        checked={email}
        onChange={(v) => { setEmail(v); setSaved(false); }}
        label="Marketing emails"
        hint="Offers, seasonal reminders and news from the garage."
        orgColor={orgColor}
      />
      <Toggle
        checked={sms}
        onChange={(v) => { setSms(v); setSaved(false); }}
        label="Marketing texts (SMS)"
        hint={hasPhone ? "Occasional offers and reminders by text." : "Add a mobile number with the garage to enable texts."}
        orgColor={orgColor}
        disabled={!hasPhone}
      />

      <p className="text-xs text-gray-500">
        These control marketing only. You&apos;ll still receive essential service messages — MOT/service reminders, invoices and quote updates.
      </p>

      {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty}
          className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
          style={{ backgroundColor: orgColor }}
        >
          {pending && <AigSpinner />}
          Save preferences
        </button>
        {saved && !dirty && (
          <span className="flex items-center gap-1 text-sm text-green-400">
            <Check className="h-4 w-4" /> Saved
          </span>
        )}
      </div>
    </div>
  );
}
