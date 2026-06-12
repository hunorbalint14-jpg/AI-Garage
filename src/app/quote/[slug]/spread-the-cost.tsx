"use client";

import { useState, useTransition } from "react";
import { startFinanceApplication } from "./finance-actions";

// "Spread the cost" card on the token-gated quote page. Customer enters the
// address Bumper needs for its soft credit check (we don't keep addresses on
// file and don't persist these), then gets sent to Bumper's hosted checkout.

const INPUT_CLASS =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-offset-0";

type Props = {
  slug: string;
  token: string;
  primaryColor: string;
  totalFormatted: string;
};

export function SpreadTheCost({ slug, token, primaryColor, totalFormatted }: Props) {
  const [open, setOpen] = useState(false);
  const [buildingNumber, setBuildingNumber] = useState("");
  const [street, setStreet] = useState("");
  const [town, setTown] = useState("");
  const [postcode, setPostcode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleStart() {
    setError(null);
    if (!buildingNumber.trim() || !town.trim() || !postcode.trim()) {
      setError("House number, town, and postcode are needed for the finance check.");
      return;
    }
    startTransition(async () => {
      const result = await startFinanceApplication(slug, token, {
        buildingNumber,
        street,
        town,
        postcode,
      });
      if ("error" in result) setError(result.error);
      else window.location.href = result.redirectUrl;
    });
  }

  return (
    <section className="rounded-lg border bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-3 flex items-center justify-between text-left"
      >
        <span>
          <span className="block text-sm font-semibold">Spread the cost</span>
          <span className="block text-xs text-slate-500">
            Pay {totalFormatted} in interest-free monthly instalments with Bumper. Soft credit
            check — no impact on your credit score.
          </span>
        </span>
        <span className="text-slate-400 text-sm">{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div className="border-t px-4 py-4 flex flex-col gap-3">
          <p className="text-xs text-slate-500">
            Bumper needs your address to run a soft eligibility check. We don&apos;t store it —
            it goes straight to Bumper.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-slate-600">
              House number / name
              <input
                className={`${INPUT_CLASS} mt-1`}
                value={buildingNumber}
                onChange={(e) => setBuildingNumber(e.target.value)}
                autoComplete="address-line1"
                disabled={pending}
              />
            </label>
            <label className="text-xs text-slate-600">
              Street
              <input
                className={`${INPUT_CLASS} mt-1`}
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                autoComplete="address-line2"
                disabled={pending}
              />
            </label>
            <label className="text-xs text-slate-600">
              Town / city
              <input
                className={`${INPUT_CLASS} mt-1`}
                value={town}
                onChange={(e) => setTown(e.target.value)}
                autoComplete="address-level2"
                disabled={pending}
              />
            </label>
            <label className="text-xs text-slate-600">
              Postcode
              <input
                className={`${INPUT_CLASS} mt-1`}
                value={postcode}
                onChange={(e) => setPostcode(e.target.value)}
                autoComplete="postal-code"
                disabled={pending}
              />
            </label>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="button"
            onClick={handleStart}
            disabled={pending}
            className="w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            style={{ backgroundColor: primaryColor }}
          >
            {pending ? "Starting…" : "Check eligibility with Bumper"}
          </button>
          <p className="text-[11px] text-slate-400 text-center">
            Finance is provided by Bumper International Ltd, authorised and regulated by the FCA.
            Subject to status; terms apply.
          </p>
        </div>
      )}
    </section>
  );
}
