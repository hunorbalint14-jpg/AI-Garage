import Link from "next/link";
import { Video, ArrowRight } from "lucide-react";

export type QuoteSummary = {
  id: string;
  status: string;
  title: string | null;
  total: number;
  created_at: string;
  sent_at: string | null;
  viewed_at: string | null;
  viewed_count: number;
  responded_at: string | null;
  expires_at: string;
  decline_reason: string | null;
};

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-green-700",
  declined: "bg-red-100 text-red-700",
  rebooked: "bg-blue-100 text-blue-700",
  expired: "bg-gray-200 text-gray-700",
  cancelled: "bg-gray-200 text-gray-700",
  approved_after_close: "bg-purple-100 text-purple-700",
};

function formatGBP(n: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

function formatDate(s: string): string {
  return new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// Read-only list of DVI quotes raised on this job. Creation stays here (the
// builder), but viewing / acting on a quote happens centrally — each row links
// to /staff/quotes/[id].
export function QuoteList({ quotes }: { quotes: QuoteSummary[] }) {
  if (quotes.length === 0) return null;

  return (
    <section className="rounded-lg border">
      <div className="p-4 border-b flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          <Video className="h-4 w-4" /> Sent quotes
        </h2>
        <Link href="/staff/quotes?type=job" className="text-xs text-muted-foreground underline">
          Manage in Quotes →
        </Link>
      </div>
      <ul className="divide-y">
        {quotes.map((q) => (
          <li key={q.id}>
            <Link
              href={`/staff/quotes/${q.id}`}
              className="flex flex-col gap-1.5 p-4 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_STYLE[q.status] ?? ""}`}>
                    {q.status.replace(/_/g, " ")}
                  </span>
                  <span className="text-sm font-medium truncate">{q.title || "(no title)"}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
                  <span>Created {formatDate(q.created_at)}</span>
                  {q.sent_at && <span>Sent {formatDate(q.sent_at)}</span>}
                  {q.viewed_at && <span>Viewed {q.viewed_count}× · last {formatDate(q.viewed_at)}</span>}
                  {q.responded_at && <span>Responded {formatDate(q.responded_at)}</span>}
                  {!q.responded_at && q.status === "pending" && <span>Expires {formatDate(q.expires_at)}</span>}
                  {q.decline_reason && <span>Reason: {q.decline_reason}</span>}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-semibold tabular-nums">{formatGBP(q.total)}</span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  View <ArrowRight className="h-3 w-3" />
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
