import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Payment cancelled · AI Garage",
  icons: {
    icon: [
      { url: "/brand/icon/aigarage-favicon.svg", type: "image/svg+xml" },
      { url: "/brand/icon/png/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
  },
};

export default async function PayCancelledPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0b0d11] text-white px-6">
      <div className="max-w-md w-full text-center rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-10">
        <h1 className="text-2xl font-bold">Payment cancelled</h1>
        <p className="mt-3 text-sm text-gray-400">
          No charge was made. You can return to your invoice email and try
          again at any time.
        </p>
        <Link
          href={`/pay/${id}`}
          className="mt-6 inline-block rounded-lg bg-green-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-500 transition-colors"
        >
          Try again
        </Link>
      </div>
    </div>
  );
}
