"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Key, Plus, Trash2, Check } from "lucide-react";
import { startRegistration } from "@simplewebauthn/browser";
import { Button } from "@/components/ui/button";
import { deletePasskey } from "./passkeys-actions";

export type PasskeyRow = {
  credential_id: string;
  device_name: string | null;
  created_at: string;
  last_used_at: string | null;
};

export function PasskeysSection({ initialPasskeys }: { initialPasskeys: PasskeyRow[] }) {
  const router = useRouter();
  const [passkeys, setPasskeys] = useState<PasskeyRow[]>(initialPasskeys);
  const [pending, startTrans] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleAdd() {
    setError(null);
    setSuccess(null);

    if (typeof window === "undefined" || !window.PublicKeyCredential) {
      setError("This browser doesn't support passkeys.");
      return;
    }

    const deviceName = prompt("Name this device (e.g. 'iPhone 15', 'Work laptop'):");
    if (!deviceName?.trim()) return;

    try {
      const beginRes = await fetch("/api/auth/passkey/register/begin", { method: "POST" });
      if (!beginRes.ok) throw new Error(`Failed to begin: ${beginRes.status}`);
      const options = await beginRes.json();

      const attestation = await startRegistration({ optionsJSON: options });

      const completeRes = await fetch("/api/auth/passkey/register/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ attestation, deviceName: deviceName.trim() }),
      });
      const result = await completeRes.json();
      if (!completeRes.ok) {
        setError(result.error ?? `Failed: ${completeRes.status}`);
        return;
      }

      setSuccess("Passkey added.");
      router.refresh();
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("NotAllowed") || msg.includes("cancel")) {
        setError("Passkey setup cancelled.");
      } else {
        setError(msg);
      }
    }
  }

  function handleDelete(credentialId: string) {
    if (!confirm("Remove this passkey? You won't be able to use it to sign in anymore.")) return;
    setError(null);
    setSuccess(null);
    startTrans(async () => {
      const result = await deletePasskey(credentialId);
      if ("error" in result) {
        setError(result.error);
      } else {
        setPasskeys((prev) => prev.filter((p) => p.credential_id !== credentialId));
        setSuccess("Passkey removed.");
      }
    });
  }

  return (
    <section className="rounded-lg border p-4">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        <Key className="h-4 w-4" /> Passkeys
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Sign in with Face ID, Touch ID, Windows Hello, or a security key. No password needed. Magic-link email login still works as backup.
      </p>

      <div className="flex flex-col gap-2">
        {passkeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No passkeys yet.</p>
        ) : (
          passkeys.map((p) => (
            <div key={p.credential_id} className="flex items-center gap-3 rounded-md border px-3 py-2">
              <Key className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{p.device_name ?? "Unnamed device"}</div>
                <div className="text-xs text-muted-foreground">
                  Added {new Date(p.created_at).toLocaleDateString("en-GB")}
                  {p.last_used_at && ` · Last used ${new Date(p.last_used_at).toLocaleDateString("en-GB")}`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(p.credential_id)}
                disabled={pending}
                className="text-muted-foreground hover:text-red-600 shrink-0"
                aria-label="Remove passkey"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Button onClick={handleAdd} variant="outline">
          <Plus className="mr-1.5 h-4 w-4" />
          Add a passkey
        </Button>
        {success && (
          <span className="flex items-center gap-1 text-sm text-green-700 dark:text-green-400">
            <Check className="h-4 w-4" />
            {success}
          </span>
        )}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </section>
  );
}
