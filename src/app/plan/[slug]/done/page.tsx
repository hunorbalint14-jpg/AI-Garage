import { CheckCircle2 } from "lucide-react";

// Static confirmation shown after Stripe Checkout returns. The subscription
// itself is recorded by the webhook (checkout.session.completed), so this page
// just reassures the customer — no token / DB lookup needed.
export default function PlanInviteDonePage() {
  return (
    <div className="relative min-h-screen bg-[#050c1a] text-white">
      <main className="relative z-10 mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 py-12">
        <div className="w-full rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center backdrop-blur-md shadow-2xl">
          <CheckCircle2 className="mx-auto mb-4 h-10 w-10 text-green-400" />
          <h1 className="text-2xl font-bold">You are subscribed</h1>
          <p className="mt-2 text-sm text-gray-400">
            Your membership is now active. A receipt is on its way by email, and you can manage or
            cancel the plan anytime from your account.
          </p>
        </div>
      </main>
    </div>
  );
}
