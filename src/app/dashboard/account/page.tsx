import Link from "next/link";
import { notFound } from "next/navigation";
import { Wallet, Receipt, ChevronRight } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortalContext } from "@/lib/portal-auth";
import { accountProfile, accountBalance } from "@/lib/account";
import { buildStatement } from "@/lib/statement";
import { PortalShell } from "../portal-shell";
import { PayBalanceButton } from "./pay-balance-button";

// Fleet / trade account view (#504 PR 5): the account contact's open balance,
// aging, open invoices and a monthly statement — the portal twin of the staff
// statement page. Only exists for account customers; everyone else 404s so the
// page never advertises itself.

function fmt(n: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function monthRange(value: string): { fromIso: string; toIso: string; label: string } {
  const [y, m] = value.split("-").map(Number);
  return {
    fromIso: new Date(Date.UTC(y, m - 1, 1)).toISOString(),
    toIso: new Date(Date.UTC(y, m, 1)).toISOString(),
    label: new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
  };
}

function shiftMonth(value: string, delta: number): string {
  const [y, m] = value.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function PortalAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; paid?: string }>;
}) {
  const { location, customer } = await getPortalContext();
  const org = location.organization;
  if (!customer) notFound();

  const admin = createAdminClient();
  const profile = await accountProfile(admin, customer.id);
  if (!profile?.accountCustomer) notFound();

  const { month, paid } = await searchParams;
  const now = new Date();
  const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const selected = month && /^\d{4}-\d{2}$/.test(month) ? month : thisMonth;
  const period = monthRange(selected);

  const [balance, invoicesRes, paymentsRes] = await Promise.all([
    accountBalance(admin, customer.id),
    admin
      .from("invoices")
      .select("id, invoice_number, issued_at, due_at, total, amount_paid, status, paid_at")
      .eq("customer_id", customer.id)
      .order("issued_at", { ascending: true }),
    admin
      .from("payments")
      .select("id, received_at, amount, method, reference")
      .eq("customer_id", customer.id)
      .order("received_at", { ascending: true }),
  ]);

  type Inv = { id: string; invoice_number: string; issued_at: string; due_at: string; total: number; amount_paid: number; status: string; paid_at: string | null };
  const invoices = (invoicesRes.data ?? []) as Inv[];
  const payments = (paymentsRes.data ?? []) as { id: string; received_at: string; amount: number; method: string; reference: string | null }[];

  const statement = buildStatement({ invoices, payments, fromIso: period.fromIso, toIso: period.toIso, now });

  const openInvoices = invoices
    .filter((i) => i.status === "sent" && Number(i.total) - Number(i.amount_paid ?? 0) > 0)
    .sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime());

  const agingChips: { label: string; value: number; alert: boolean }[] = [
    { label: "Not yet due", value: statement.aging.current, alert: false },
    { label: "1–30 days", value: statement.aging.d30, alert: statement.aging.d30 > 0 },
    { label: "31–60 days", value: statement.aging.d60, alert: statement.aging.d60 > 0 },
    { label: "60+ days", value: statement.aging.d90, alert: statement.aging.d90 > 0 },
  ];

  return (
    <PortalShell org={org}>
      <div>
        <h1 className="text-2xl font-bold">Your account</h1>
        <p className="mt-1 text-sm text-gray-400">
          Trade account with {org.name} · {profile.paymentTermsDays}-day payment terms
          {profile.creditLimit !== null && <> · {fmt(profile.creditLimit)} credit limit</>}
        </p>
      </div>

      {/* Balance */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-sm">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gray-500">
          <Wallet className="h-4 w-4" /> Balance on account
        </div>
        <p className="mt-2 text-3xl font-bold tabular-nums">{fmt(balance.total)}</p>
        <p className="mt-1 text-sm text-gray-400">
          {fmt(balance.openInvoiced)} invoiced
          {balance.unbilledJobCount > 0 && (
            <>
              {" "}+ {fmt(balance.unbilledJobs)} across {balance.unbilledJobCount} job
              {balance.unbilledJobCount === 1 ? "" : "s"} awaiting your monthly invoice
            </>
          )}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {agingChips.map((c) => (
            <div
              key={c.label}
              className={`rounded-xl border px-3 py-2 ${c.alert ? "border-red-500/30 bg-red-500/10" : "border-white/10 bg-white/[0.03]"}`}
            >
              <p className="text-[11px] uppercase tracking-wider text-gray-500">{c.label}</p>
              <p className={`mt-0.5 font-semibold tabular-nums ${c.alert ? "text-red-400" : ""}`}>{fmt(c.value)}</p>
            </div>
          ))}
        </div>
        {paid === "1" && (
          <p className="mt-4 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-400">
            Payment received — thank you. Your balance and statement update as soon as the payment is confirmed
            (usually within a minute).
          </p>
        )}
        {statement.totalOutstanding > 0 && paid !== "1" && (
          <PayBalanceButton amountLabel={fmt(statement.totalOutstanding)} accent={org.primary_color} />
        )}
      </section>

      {/* Open invoices */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gray-500">
          <Receipt className="h-4 w-4" /> Open invoices
        </h2>
        {openInvoices.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-gray-400 backdrop-blur-sm">
            Nothing outstanding — you&apos;re all settled.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {openInvoices.map((inv) => {
              const outstanding = Math.round((Number(inv.total) - Number(inv.amount_paid ?? 0)) * 100) / 100;
              const overdue = new Date(inv.due_at) < now;
              const partPaid = Number(inv.amount_paid ?? 0) > 0;
              return (
                <Link
                  key={inv.id}
                  href={`/invoice/${inv.id}`}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-sm transition-colors hover:bg-white/[0.06]"
                >
                  <div>
                    <p className="font-mono text-sm font-semibold">{inv.invoice_number}</p>
                    <p className="text-xs text-gray-400">
                      Due {fmtDate(inv.due_at)}
                      {partPaid && <> · {fmt(Number(inv.amount_paid))} paid</>}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold tabular-nums">{fmt(outstanding)}</span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${overdue ? "bg-red-500/20 text-red-400" : "bg-blue-500/20 text-blue-400"}`}
                    >
                      {overdue ? "overdue" : "open"}
                    </span>
                    <ChevronRight className="h-5 w-5 shrink-0 text-gray-500" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Statement */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Statement — {period.label}</h2>
          <div className="flex items-center gap-1 text-sm">
            <Link
              href={`/dashboard/account?month=${shiftMonth(selected, -1)}`}
              className="rounded-lg border border-white/10 px-2.5 py-1 text-gray-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              ←
            </Link>
            {selected < thisMonth && (
              <Link
                href={`/dashboard/account?month=${shiftMonth(selected, 1)}`}
                className="rounded-lg border border-white/10 px-2.5 py-1 text-gray-300 transition-colors hover:bg-white/10 hover:text-white"
              >
                →
              </Link>
            )}
          </div>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-wider text-gray-500">
                <th className="px-4 py-2.5 font-medium">Date</th>
                <th className="px-4 py-2.5 font-medium">Detail</th>
                <th className="px-4 py-2.5 text-right font-medium">Charged</th>
                <th className="px-4 py-2.5 text-right font-medium">Paid</th>
                <th className="px-4 py-2.5 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-white/5 text-gray-400">
                <td className="px-4 py-2.5" colSpan={4}>
                  Opening balance
                </td>
                <td className="px-4 py-2.5 text-right font-medium tabular-nums">{fmt(statement.opening)}</td>
              </tr>
              {statement.lines.map((l, i) => (
                <tr key={i} className="border-b border-white/5">
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-400">{fmtDate(l.date)}</td>
                  <td className="px-4 py-2.5">
                    {l.kind === "invoice" ? (
                      <span className="font-mono">{l.reference}</span>
                    ) : (
                      <span className="capitalize text-gray-300">Payment · {l.reference}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{l.debit !== null ? fmt(l.debit) : ""}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-green-400">{l.credit !== null ? `−${fmt(l.credit)}` : ""}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmt(l.balance)}</td>
                </tr>
              ))}
              {statement.lines.length === 0 && (
                <tr className="border-b border-white/5">
                  <td className="px-4 py-3 text-center text-gray-500" colSpan={5}>
                    No activity this month.
                  </td>
                </tr>
              )}
              <tr className="font-semibold">
                <td className="px-4 py-2.5" colSpan={4}>
                  Closing balance
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmt(statement.closing)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Statements cover invoiced work only — jobs awaiting your monthly invoice appear once billed. Work history for
          each vehicle lives in{" "}
          <Link href="/dashboard/history" className="text-gray-300 underline underline-offset-2 hover:text-white">
            Service history
          </Link>
          .
        </p>
      </section>
    </PortalShell>
  );
}
