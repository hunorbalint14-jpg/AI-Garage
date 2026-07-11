import Link from "next/link";
import { resolveHoursForDate, APP_TZ, type WeeklyHours, type SpecialHours } from "@/lib/business-hours";
import type { MiniSite as MiniSiteData, MiniSiteBranch } from "@/lib/minisite-data";

// Public garage mini-site (#507 PR 2). RSC-only, no client JS beyond anchor
// links — performance is architecture: one accent colour, system stack, no
// animation, nothing blocking.

const fmtGBP = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: n % 1 ? 2 : 0 }).format(n);

const minToLabel = (m: number) => {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const ap = h >= 12 ? "pm" : "am";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return mm === 0 ? `${hh}${ap}` : `${hh}:${String(mm).padStart(2, "0")}${ap}`;
};

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function todayKeyUK(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: APP_TZ });
}

// The rendered week: Mon–Sun regular hours with today resolved through the
// engine (special days win — a bank-holiday closure shows on the day).
function weekRows(weekly: WeeklyHours, special: SpecialHours[]) {
  const today = todayKeyUK();
  const todayWd = new Date(`${today}T12:00:00`).getDay();
  return [1, 2, 3, 4, 5, 6, 0].map((wd) => {
    const isToday = wd === todayWd;
    const resolved = isToday ? resolveHoursForDate(weekly, special, today) : null;
    const hours = isToday ? resolved!.hours : (weekly[wd] ?? null);
    const open = isToday ? resolved!.open : !!weekly[wd];
    return {
      wd,
      label: DAY_LABELS[wd],
      isToday,
      text: open && hours ? `${minToLabel(hours.open)} – ${minToLabel(hours.close)}` : "Closed",
    };
  });
}

function phoneHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

function whatsappHref(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "").replace(/^0/, "44");
  return `https://wa.me/${digits}`;
}

function mapsHref(name: string, address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name}, ${address}`)}`;
}

function BranchHours({ branch }: { branch: MiniSiteBranch }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {weekRows(branch.weekly, branch.special).map((r) => (
          <tr key={r.wd} className={r.isToday ? "font-semibold" : "text-neutral-400"}>
            <td className="py-1 pr-4">
              {r.label}
              {r.isToday && <span className="ml-2 rounded-full border border-neutral-700 px-2 py-px text-[10px] font-normal uppercase tracking-wide">today</span>}
            </td>
            <td className="py-1 text-right tabular-nums">{r.text}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function MiniSitePage({ site }: { site: MiniSiteData }) {
  const accent = site.org.primaryColor;
  const primary = site.branches[0] ?? null;
  const multi = site.branches.length > 1;
  // De-dupe services across branches by name for the single grid; from-price =
  // cheapest across branches.
  const serviceMap = new Map<string, { name: string; price: number | null }>();
  for (const b of site.branches) {
    for (const s of b.services) {
      const cur = serviceMap.get(s.name.toLowerCase());
      if (!cur || (s.price !== null && (cur.price === null || s.price < cur.price))) {
        serviceMap.set(s.name.toLowerCase(), { name: s.name, price: s.price });
      }
    }
  }
  const services = [...serviceMap.values()].slice(0, 12);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      {/* Header */}
      <header className="mx-auto flex max-w-4xl items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          {site.org.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={site.org.logoUrl} alt={site.org.name} className="h-9 w-auto object-contain" loading="eager" />
          ) : (
            <span
              className="flex h-9 w-9 items-center justify-center rounded-lg text-sm font-bold text-white"
              style={{ backgroundColor: accent }}
            >
              {site.org.name.split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 2)}
            </span>
          )}
          <span className="text-base font-semibold">{site.org.name}</span>
        </div>
        {site.org.phone && (
          <a href={phoneHref(site.org.phone)} className="text-sm text-neutral-300 hover:text-white">
            {site.org.phone}
          </a>
        )}
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-4xl px-5 pb-14 pt-10 text-center sm:pt-16">
        <h1 className="text-3xl font-bold leading-tight sm:text-5xl">{site.org.name}</h1>
        <p className="mx-auto mt-3 max-w-xl text-base text-neutral-400 sm:text-lg">
          {site.strapline ?? `MOTs, servicing and repairs${primary?.address ? ` — ${primary.address.split(",").pop()?.trim()}` : ""}. Book online in under a minute.`}
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/book"
            className="rounded-lg px-6 py-3 text-base font-semibold text-white"
            style={{ backgroundColor: accent }}
          >
            Book now
          </Link>
          {site.org.phone && (
            <a
              href={phoneHref(site.org.phone)}
              className="rounded-lg border border-neutral-700 px-6 py-3 text-base font-semibold text-neutral-200 hover:border-neutral-500"
            >
              Call us
            </a>
          )}
        </div>
      </section>

      {/* Services */}
      {site.sections.services && services.length > 0 && (
        <section className="mx-auto max-w-4xl px-5 pb-14">
          <h2 className="mb-4 text-xl font-semibold">Services &amp; prices</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {services.map((s) => (
              <li key={s.name} className="flex items-baseline justify-between gap-3 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3">
                <span className="text-sm font-medium">{s.name}</span>
                <span className="whitespace-nowrap text-sm text-neutral-400">
                  {s.price !== null ? <>from <span className="font-semibold text-neutral-100">{fmtGBP(s.price)}</span></> : "ask"}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <Link href="/book" className="text-sm font-semibold underline underline-offset-4" style={{ color: accent }}>
              See live availability →
            </Link>
          </div>
        </section>
      )}

      {/* Hours */}
      {site.sections.hours && primary && (
        <section className="mx-auto max-w-4xl px-5 pb-14">
          <h2 className="mb-4 text-xl font-semibold">Opening hours</h2>
          <div className={`grid gap-6 ${multi ? "sm:grid-cols-2" : "max-w-md"}`}>
            {site.branches.map((b) => (
              <div key={b.id} className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
                {multi && <h3 className="mb-2 text-sm font-semibold">{b.name}</h3>}
                <BranchHours branch={b} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Branches / find us */}
      {site.sections.branches && (
        <section className="mx-auto max-w-4xl px-5 pb-14">
          <h2 className="mb-4 text-xl font-semibold">{multi ? "Our branches" : "Find us"}</h2>
          <div className={`grid gap-4 ${multi ? "sm:grid-cols-2" : "max-w-md"}`}>
            {site.branches.map((b) => (
              <div key={b.id} className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-sm">
                <p className="font-semibold">{b.name}</p>
                {b.address && <p className="mt-1 text-neutral-400">{b.address}</p>}
                <div className="mt-3 flex flex-wrap gap-3">
                  {b.address && (
                    <a href={mapsHref(site.org.name, b.address)} target="_blank" rel="noopener" className="font-semibold underline underline-offset-4" style={{ color: accent }}>
                      Directions
                    </a>
                  )}
                  {site.org.phone && (
                    <>
                      <a href={phoneHref(site.org.phone)} className="text-neutral-300 underline underline-offset-4 hover:text-white">
                        Call
                      </a>
                      <a href={whatsappHref(site.org.phone)} target="_blank" rel="noopener" className="text-neutral-300 underline underline-offset-4 hover:text-white">
                        WhatsApp
                      </a>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* About */}
      {site.sections.about && site.about && (
        <section className="mx-auto max-w-4xl px-5 pb-14">
          <h2 className="mb-4 text-xl font-semibold">About us</h2>
          <p className="max-w-2xl whitespace-pre-line text-sm leading-relaxed text-neutral-300">{site.about}</p>
        </section>
      )}

      {/* Reviews */}
      {site.sections.reviews && site.org.googleReviewUrl && (
        <section className="mx-auto max-w-4xl px-5 pb-14">
          <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5 text-center">
            <p className="text-sm text-neutral-300">See what our customers say</p>
            <a
              href={site.org.googleReviewUrl}
              target="_blank"
              rel="noopener"
              className="mt-2 inline-block text-sm font-semibold underline underline-offset-4"
              style={{ color: accent }}
            >
              Read our Google reviews →
            </a>
          </div>
        </section>
      )}

      {/* Book CTA repeat + footer */}
      <section className="mx-auto max-w-4xl px-5 pb-16 text-center">
        <Link
          href="/book"
          className="inline-block rounded-lg px-6 py-3 text-base font-semibold text-white"
          style={{ backgroundColor: accent }}
        >
          Book your visit online
        </Link>
      </section>
      <footer className="border-t border-neutral-900 py-6 text-center text-xs text-neutral-500">
        <div className="flex items-center justify-center gap-4">
          <span>{site.org.name}</span>
          <Link href="/login" className="underline underline-offset-4 hover:text-neutral-300">
            Customer sign in
          </Link>
          <Link href="/staff/login" className="underline underline-offset-4 hover:text-neutral-300">
            Staff
          </Link>
        </div>
      </footer>
    </div>
  );
}
