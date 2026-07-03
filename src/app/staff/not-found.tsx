import Link from "next/link";

// Staff-portal 404 (notFound() from a staff route, e.g. a stale/foreign-org
// detail URL). Renders inside the shell so staff keep their navigation.
export default function StaffNotFound() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-10 text-center">
        <p className="font-mono text-5xl font-bold text-green-500">404</p>
        <h1 className="mt-4 text-2xl font-bold text-white">Not found</h1>
        <p className="mt-3 text-sm text-gray-400">
          This record doesn&apos;t exist in your organisation — the link may be stale, or the item
          was deleted.
        </p>
        <Link
          href="/staff"
          className="mt-6 inline-block rounded-lg bg-green-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-500"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
