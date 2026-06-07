"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AigSpinner } from "@/components/ui/aig-spinner";
import { invitePlatformAdmin, setOwnPassword } from "./actions";

export function InviteForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setMsg(null);
    const form = e.currentTarget;
    const result = await invitePlatformAdmin(new FormData(form));
    setPending(false);
    if ("error" in result) {
      setMsg({ ok: false, text: result.error });
      return;
    }
    setMsg({ ok: true, text: "Invited — a sign-in link has been emailed." });
    form.reset();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <input
        type="email"
        name="email"
        required
        placeholder="operator@example.com"
        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-white/30 focus:outline-none"
      />
      {msg && <p className={`text-xs ${msg.ok ? "text-[#5fdd9d]" : "text-red-400"}`}>{msg.text}</p>}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center justify-center gap-2 self-start rounded-lg bg-[#22c55e] px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending && <AigSpinner />}
        Send invite
      </button>
    </form>
  );
}

export function SetPasswordForm() {
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setMsg(null);
    const form = e.currentTarget;
    const result = await setOwnPassword(new FormData(form));
    setPending(false);
    if ("error" in result) {
      setMsg({ ok: false, text: result.error });
      return;
    }
    setMsg({ ok: true, text: "Password updated." });
    form.reset();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <input
        type="password"
        name="password"
        required
        autoComplete="new-password"
        placeholder="New password"
        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-white/30 focus:outline-none"
      />
      {msg && <p className={`text-xs ${msg.ok ? "text-[#5fdd9d]" : "text-red-400"}`}>{msg.text}</p>}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center justify-center gap-2 self-start rounded-lg border border-[#2a2f37] px-4 py-2 text-sm font-semibold text-[#e6e8eb] transition-colors hover:bg-white/[0.04] disabled:opacity-60"
      >
        {pending && <AigSpinner />}
        Update password
      </button>
    </form>
  );
}
