import { createAdminClient } from "@/lib/supabase/admin";
import { resolveUnsubscribeToken } from "@/lib/unsubscribe";
import { unsubscribeAction } from "./actions";

// Marketing opt-out landing page (#596 PR 5). Reached from the link in a
// marketing email or text. Token-gated like the other public links; an
// unknown token gets a neutral page rather than confirming it exists.

export const dynamic = "force-dynamic";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f4f0] flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">{children}</div>
    </div>
  );
}

const DONE_TEXT: Record<string, string> = {
  email: "You won't get marketing emails from us any more.",
  sms: "You won't get marketing texts from us any more.",
  all: "You won't get marketing emails or texts from us any more.",
};

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ u?: string; done?: string }>;
}) {
  const { u: token, done } = await searchParams;
  const ctx = await resolveUnsubscribeToken(createAdminClient(), token ?? null);

  if (!ctx) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-gray-900">This link has expired</h1>
        <p className="mt-2 text-sm text-gray-600">
          To change which messages you receive, contact the garage directly or update your preferences in your
          account.
        </p>
      </Shell>
    );
  }

  if (done && DONE_TEXT[done]) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-gray-900">You&apos;re unsubscribed</h1>
        <p className="mt-2 text-sm text-gray-600">{DONE_TEXT[done]}</p>
        <p className="mt-4 text-xs text-gray-500">
          You&apos;ll still hear from {ctx.orgName} about bookings and work on your vehicle — confirmations,
          reminders you asked for, and invoices aren&apos;t marketing.
        </p>
      </Shell>
    );
  }

  const nothingLeft = !ctx.emailConsent && !ctx.smsConsent;

  return (
    <Shell>
      <h1 className="text-xl font-semibold text-gray-900">Stop marketing messages</h1>
      <p className="mt-2 text-sm text-gray-600">
        Choose what you&apos;d like to stop receiving from {ctx.orgName}: offers, and suggestions such as tyre care.
      </p>

      {nothingLeft ? (
        <p className="mt-6 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700">
          You&apos;re already unsubscribed from marketing emails and texts.
        </p>
      ) : (
        <form action={unsubscribeAction} className="mt-6 flex flex-col gap-2">
          <input type="hidden" name="u" value={token} />
          {ctx.emailConsent && ctx.smsConsent && (
            <button
              type="submit"
              name="channel"
              value="all"
              className="rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800"
            >
              Unsubscribe from everything
            </button>
          )}
          {ctx.emailConsent && (
            <button
              type="submit"
              name="channel"
              value="email"
              className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-800 hover:bg-gray-50"
            >
              Stop marketing emails
            </button>
          )}
          {ctx.smsConsent && (
            <button
              type="submit"
              name="channel"
              value="sms"
              className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-800 hover:bg-gray-50"
            >
              Stop marketing texts
            </button>
          )}
        </form>
      )}

      <p className="mt-6 text-xs text-gray-500">
        Messages about your bookings, jobs and invoices aren&apos;t affected.
      </p>
    </Shell>
  );
}
