"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AigSpinner } from "@/components/ui/aig-spinner";
import {
  searchReceptionistNumbers,
  provisionReceptionistNumber,
  releaseReceptionistNumber,
} from "./receptionist-actions";
import type { AvailableNumber, NumberType } from "@/lib/receptionist/provisioning";

export type ReceptionistLoc = {
  id: string;
  name: string;
  twilioNumber: string | null;
  enabled: boolean;
};

function ReceptionistRow({ loc }: { loc: ReceptionistLoc }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Search state (only used when the location has no number yet).
  const [searchOpen, setSearchOpen] = useState(false);
  const [type, setType] = useState<NumberType>("mobile");
  const [areaCode, setAreaCode] = useState("");
  const [contains, setContains] = useState("");
  const [results, setResults] = useState<AvailableNumber[] | null>(null);

  async function onSearch() {
    setBusy(true);
    setMsg(null);
    setResults(null);
    const res = await searchReceptionistNumbers({ country: "GB", type, areaCode: areaCode.trim() || undefined, contains: contains.trim() || undefined });
    setBusy(false);
    if ("error" in res) {
      setMsg({ ok: false, text: res.error });
      return;
    }
    setResults(res.numbers);
  }

  async function onBuy(phoneNumber: string) {
    if (!confirm(`Buy ${phoneNumber} and assign it to ${loc.name}?\n\nThis charges the platform Twilio account and the number starts billing immediately.`)) {
      return;
    }
    setBusy(true);
    setMsg(null);
    const res = await provisionReceptionistNumber({ locationId: loc.id, phoneNumber });
    setBusy(false);
    if ("error" in res) {
      setMsg({ ok: false, text: res.error });
      return;
    }
    setMsg({ ok: true, text: `Provisioned ${res.phoneNumber}.` });
    setResults(null);
    setSearchOpen(false);
    router.refresh();
  }

  async function onRelease() {
    if (!confirm(`Release ${loc.twilioNumber} from ${loc.name}?\n\nThe number is returned to Twilio (stops billing) and the receptionist is disabled for this location.`)) {
      return;
    }
    setBusy(true);
    setMsg(null);
    const res = await releaseReceptionistNumber({ locationId: loc.id });
    setBusy(false);
    if ("error" in res) {
      setMsg({ ok: false, text: res.error });
      return;
    }
    setMsg({ ok: true, text: "Released." });
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-[#23272f] bg-[#15181d] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-white">{loc.name}</div>
          {loc.twilioNumber ? (
            <div className="mt-0.5 flex items-center gap-2 font-mono text-xs">
              <span className="text-[#5fdd9d]">{loc.twilioNumber}</span>
              <span className={loc.enabled ? "text-[#5fdd9d]" : "text-[#5a6170]"}>
                {loc.enabled ? "enabled" : "not enabled"}
              </span>
            </div>
          ) : (
            <div className="mt-0.5 text-xs text-[#5a6170]">No number provisioned</div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {busy && <AigSpinner />}
          {loc.twilioNumber ? (
            <button
              type="button"
              onClick={onRelease}
              disabled={busy}
              className="rounded-lg border border-[#5a2a2a] px-3 py-1.5 text-xs font-semibold text-[#e58b8b] transition-colors hover:bg-red-500/10 disabled:opacity-50"
            >
              Release
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setSearchOpen((v) => !v)}
              disabled={busy}
              className="rounded-lg border border-[#2a2f37] px-3 py-1.5 text-xs font-semibold text-[#e6e8eb] transition-colors hover:bg-white/[0.04] disabled:opacity-50"
            >
              {searchOpen ? "Cancel" : "Provision number"}
            </button>
          )}
        </div>
      </div>

      {searchOpen && !loc.twilioNumber && (
        <div className="mt-3 flex flex-col gap-3 border-t border-[#23272f] pt-3">
          <div className="flex flex-wrap items-end gap-2 text-xs">
            <label className="flex flex-col gap-1 text-[#9aa1ad]">
              Type
              <select
                value={type}
                onChange={(e) => setType(e.target.value as NumberType)}
                className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-white focus:border-white/30 focus:outline-none"
              >
                <option value="mobile">Mobile (+447 — best for SMS)</option>
                <option value="local">Local (+441/+442)</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[#9aa1ad]">
              Area code
              <input
                value={areaCode}
                onChange={(e) => setAreaCode(e.target.value)}
                placeholder="optional"
                className="w-24 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 font-mono text-white focus:border-white/30 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-[#9aa1ad]">
              Contains
              <input
                value={contains}
                onChange={(e) => setContains(e.target.value)}
                placeholder="digits"
                className="w-28 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 font-mono text-white focus:border-white/30 focus:outline-none"
              />
            </label>
            <button
              type="button"
              onClick={onSearch}
              disabled={busy}
              className="rounded-lg border border-[#2a2f37] px-3 py-1.5 font-semibold text-[#e6e8eb] transition-colors hover:bg-white/[0.04] disabled:opacity-50"
            >
              Search
            </button>
          </div>

          {results && results.length > 0 && (
            <ul className="flex flex-col gap-1">
              {results.map((n) => (
                <li
                  key={n.phoneNumber}
                  className="flex items-center justify-between gap-2 rounded-lg border border-[#23272f] bg-[#101216] px-3 py-1.5"
                >
                  <span className="font-mono text-xs text-white">
                    {n.phoneNumber}
                    {(n.locality || n.region) && (
                      <span className="ml-2 text-[#5a6170]">{[n.locality, n.region].filter(Boolean).join(", ")}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => onBuy(n.phoneNumber)}
                    disabled={busy}
                    className="rounded-lg border border-[#2a5a3a] bg-[#13301f] px-3 py-1 text-xs font-semibold text-[#5fdd9d] transition-colors hover:bg-[#163a26] disabled:opacity-50"
                  >
                    Buy &amp; assign
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {msg && <p className={`mt-2 text-xs ${msg.ok ? "text-[#5fdd9d]" : "text-red-400"}`}>{msg.text}</p>}
    </div>
  );
}

export function ReceptionistNumbers({ locations }: { locations: ReceptionistLoc[] }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-lg border border-[#4a3a13] bg-[#2a2110] px-3 py-2 text-xs text-[#e8c97a]">
        ⚠ Buying a number charges the platform Twilio account and starts monthly billing. Webhooks are wired
        automatically; the garage still sets a forward number and enables the receptionist from their portal.
      </p>
      {locations.map((loc) => (
        <ReceptionistRow key={loc.id} loc={loc} />
      ))}
      {locations.length === 0 && <p className="text-sm text-[#5a6170]">No locations.</p>}
    </div>
  );
}
