import Link from "next/link";

export default async function PayDonePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0b0d11] text-white px-6">
      <div className="max-w-md w-full text-center rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-10">
        <div className="mx-auto mb-6 inline-flex h-14 w-14 items-center justify-center rounded-full bg-green-500/20 text-green-300 text-3xl">
          ✓
        </div>
        <h1 className="text-2xl font-bold">Payment received</h1>
        <p className="mt-3 text-sm text-gray-400">
          Thanks — the garage has been notified that invoice{" "}
          <span className="font-mono text-gray-200">{id.slice(0, 8)}</span> is paid.
        </p>
        <p className="mt-6 text-xs text-gray-500">
          If a receipt was requested, Stripe will email it to you shortly.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block text-sm text-green-300 underline"
        >
          Return home
        </Link>
      </div>
    </div>
  );
}
