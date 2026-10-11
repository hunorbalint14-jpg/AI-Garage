import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  CarFront,
  Check,
  ClipboardCheck,
  Clock,
  CreditCard,
  Disc3,
  FileSignature,
  Fingerprint,
  Globe,
  Hammer,
  HandCoins,
  History,
  Landmark,
  LifeBuoy,
  ListChecks,
  MapPin,
  Megaphone,
  Mic,
  Package,
  PhoneCall,
  Receipt,
  Repeat,
  Rocket,
  RotateCcw,
  ScrollText,
  ShieldCheck,
  Smartphone,
  Star,
  Stethoscope,
  Upload,
  Users,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { AnimatedBackground } from "@/components/animated-background";
import { BETA_SURFACES } from "@/lib/beta-registry";
import { TIERS, type FeatureKey, type TierConfig } from "@/lib/tenant-plans";

// Apex marketing page (no tenant subdomain). Feature copy mirrors what's
// shipped — the staff nav groups (Ops / Money / Grow), the user manual and
// release notes. Beta pills read BETA_SURFACES, so graduating a surface there
// drops its pill here too; pricing renders from TIERS so it can't drift from
// the billing page.

type Feature = {
  icon: LucideIcon;
  title: string;
  desc: string;
  /** BETA_SURFACES key — shows a Beta pill while the surface is listed there. */
  beta?: string;
};

type FeatureGroup = {
  id: string;
  eyebrow: string;
  title: string;
  intro: string;
  features: Feature[];
};

const isBeta = (key?: string) => !!key && BETA_SURFACES.some((s) => s.key === key);

const JOURNEY: { icon: LucideIcon; label: string }[] = [
  { icon: CalendarDays, label: "Booked" },
  { icon: Hammer, label: "On the ramp" },
  { icon: ClipboardCheck, label: "Health check" },
  { icon: FileSignature, label: "Approved" },
  { icon: Receipt, label: "Invoiced" },
  { icon: CreditCard, label: "Paid" },
];

const PROOF = [
  "DVLA & DVSA vehicle data",
  "VAT & Making Tax Digital",
  "Stripe card payments",
  "Xero · QuickBooks · Sage",
  "Email · SMS · WhatsApp",
];

const GROUPS: FeatureGroup[] = [
  {
    id: "workshop",
    eyebrow: "Run the workshop",
    title: "From the first call to the car going home",
    intro: "Bookings, the job board, health checks and parts in one place — on the desk PC or a phone in the workshop.",
    features: [
      {
        icon: CalendarDays,
        title: "Online booking & calendar",
        desc: "Customers book genuine free slots from your booking link, day or night. Per-day opening hours, bank-holiday overrides, deposits and no-show protection.",
      },
      {
        icon: Hammer,
        title: "Workshop job board",
        desc: "Turn a booking into a job in a tap, assign a bay and a technician, add parts and labour as you go and track time on every job.",
      },
      {
        icon: ClipboardCheck,
        title: "Digital vehicle health checks",
        desc: "Grade a 33-point check on your phone with photos — red, amber, OK. The customer gets a branded report and approves work item by item.",
        beta: "evhc",
      },
      {
        icon: Landmark,
        title: "Vehicle data on tap",
        desc: "Enter a reg and the make, model, MOT history and open recalls arrive from DVLA and DVSA. MOT due dates refresh daily — even if it was tested elsewhere.",
      },
      {
        icon: CarFront,
        title: "Courtesy cars",
        desc: "A seven-day loan diary with check-out and check-in, a hire-style damage map and photo history for every car you lend.",
      },
      {
        icon: Package,
        title: "Parts, suppliers & purchase orders",
        desc: "Stock levels with reorder points, purchase orders that top stock back up when received, and orders sent to each supplier your way.",
      },
    ],
  },
  {
    id: "money",
    eyebrow: "Get paid",
    title: "Quotes approved, invoices paid, books straight",
    intro: "Card payments land in your own Stripe account — AI Garage never holds your takings.",
    features: [
      {
        icon: Smartphone,
        title: "Quotes customers approve on their phone",
        desc: "Send a quote with photos by email, SMS or WhatsApp. Customers approve line by line, pay a deposit and get reminded before it expires.",
      },
      {
        icon: FileSignature,
        title: "Signed work authorisation",
        desc: "A tamper-proof record of what was approved, when and from where. If the job grows, a one-tap re-authorisation covers you before the extra work starts.",
      },
      {
        icon: Receipt,
        title: "Invoices & card payments",
        desc: "Raise the invoice from the job with VAT worked out — MOTs treated as outside scope automatically — then take payment by card in person or by link.",
      },
      {
        icon: HandCoins,
        title: "Spread the cost",
        desc: "Offer regulated finance on bigger bills. The customer applies from the invoice in a few taps; you are paid in full.",
      },
      {
        icon: Building2,
        title: "Trade & fleet accounts",
        desc: "Payment terms and credit limits, one month-end invoice, statements with aging, and a portal where fleet contacts see their balance.",
      },
      {
        icon: Repeat,
        title: "Service plans",
        desc: "Monthly memberships with an included MOT and service plus a member discount — free at booking only once the plan has paid in enough to cover it.",
      },
      {
        icon: ScrollText,
        title: "Accounting sync & MTD",
        desc: "Connect Xero, QuickBooks or Sage and invoices, payments and refunds sync across — no re-keying, and the digital link Making Tax Digital expects.",
      },
      {
        icon: BarChart3,
        title: "Job profit & reports",
        desc: "Parts cost and labour rate make every job a mini P&L. See gross profit, your effective labour rate and what is dragging margin.",
      },
      {
        icon: Clock,
        title: "Overdue invoices chased for you",
        desc: "Polite reminders at 1, 7 and 14 days overdue, sent from the branch that did the work.",
      },
    ],
  },
  {
    id: "grow",
    eyebrow: "Keep them coming back",
    title: "The follow-up that never gets forgotten",
    intro: "Reminders, reviews and win-back run on their own, and every message respects each customer's contact preferences.",
    features: [
      {
        icon: Bell,
        title: "MOT & service reminders",
        desc: "Personalised reminders by email, SMS or WhatsApp ahead of every due date — sent once, from the customer's home branch.",
      },
      {
        icon: RotateCcw,
        title: "Win-back",
        desc: "Spot vehicles overdue a visit and customers who had their MOT done elsewhere, then reach out before they're gone for good.",
      },
      {
        icon: History,
        title: "Deferred work that chases itself",
        desc: "Declined and advised work sits in one pipeline with its value. Automatic follow-ups bring it back with a booking link, and recovered revenue is tracked.",
        beta: "deferred",
      },
      {
        icon: Disc3,
        title: "Tyre care",
        desc: "Rotation and alignment suggestions raised overnight from tread readings, MOT advisories and mileage — each one reviewed by your team before it's sent.",
        beta: "tyre-care",
      },
      {
        icon: Star,
        title: "Reviews & a pulse after every visit",
        desc: "A one-tap “How was it?” after each job. Happy customers are pointed at your Google reviews; unhappy ones come straight to you.",
      },
      {
        icon: Megaphone,
        title: "Campaigns",
        desc: "Seasonal offers and announcements by email or SMS, sent only to customers who have opted in to marketing.",
      },
      {
        icon: Globe,
        title: "Your garage website",
        desc: "Publish a fast one-page site at your booking address — services and prices, live opening hours, branches, reviews and a Book now button.",
      },
      {
        icon: PhoneCall,
        title: "AI receptionist",
        desc: "Texts back the calls you miss, answers price questions from your service list and books customers into real free slots.",
        beta: "receptionist",
      },
    ],
  },
];

const PORTAL_POINTS = [
  "Every vehicle with its MOT history and what's due next",
  "Book, reschedule or cancel without phoning",
  "Approve quotes and health-check items line by line",
  "Pay invoices by card — or spread the cost",
  "Service history, documents and their plan in one place",
  "Sign in with an email link, or Face ID and fingerprint passkeys",
];

const AI_FEATURES: Feature[] = [
  {
    icon: Wand2,
    title: "Help with every message",
    desc: "Every compose box has an AI Assist menu — write it for me, improve it, shorten it, change the tone. Your team writes; AI helps when asked.",
  },
  {
    icon: ClipboardCheck,
    title: "Shorthand into plain English",
    desc: "“osf lower arm bush split” becomes a clear explanation of what was found and why it matters.",
  },
  {
    icon: Mic,
    title: "Talk instead of typing",
    desc: "Dictate notes on the job and they become a clean summary and line items, ready to check.",
  },
  {
    icon: Clock,
    title: "Labour times & parts",
    desc: "Suggested labour times and parts with your margin applied, so quotes go out faster.",
  },
  {
    icon: Stethoscope,
    title: "Diagnostic help",
    desc: "Describe a symptom and get likely causes and next checks — for technicians, and for customers on the portal.",
  },
  {
    icon: Bell,
    title: "Writes in your garage's voice",
    desc: "A short setup survey teaches every AI feature how your garage talks, what you do and what you don't.",
  },
  {
    icon: Upload,
    title: "Moves your data in",
    desc: "Importing from a system we haven't seen? AI proposes the column mapping; you confirm it.",
  },
  {
    icon: LifeBuoy,
    title: "Help that knows your garage",
    desc: "The support assistant answers from the manual and your own settings — and never shows someone what their role can't see.",
    beta: "support_assist",
  },
];

const BRANCH_POINTS: { icon: LucideIcon; title: string; desc: string }[] = [
  {
    icon: Users,
    title: "Customers recognised everywhere",
    desc: "A customer registers once and is known at every branch. Jobs, bays and invoices stay with the branch that did the work.",
  },
  {
    icon: MapPin,
    title: "Every message names the branch",
    desc: "Emails, texts and WhatsApps carry the branch name and address, so customers always know where to go.",
  },
  {
    icon: ShieldCheck,
    title: "Roles that fit how you work",
    desc: "Owners, admins, accountants and branch staff, with permission templates — and a dashboard that leads with what each role needs.",
  },
  {
    icon: Fingerprint,
    title: "Secure by default",
    desc: "Passkeys and two-factor sign-in, sessions that expire after 12 hours, and an audit log of who changed what.",
  },
];

const SWITCH_POINTS: { icon: LucideIcon; title: string; desc: string }[] = [
  {
    icon: Upload,
    title: "Bring your history",
    desc: "Import customers, vehicles, service history, reminder dates and past invoices from TechMan, Garage Hive, Autowork Online or any CSV. Preview first; nothing half-imported is ever saved.",
  },
  {
    icon: ListChecks,
    title: "A checklist that ticks itself",
    desc: "Setup steps tick off as real things get done. Explore with clearly-badged sample data, then wipe it in one click.",
  },
  {
    icon: Rocket,
    title: "Go live when you're ready",
    desc: "Set up and test each branch quietly — automated customer messages are held until you switch that branch live.",
  },
  {
    icon: LifeBuoy,
    title: "Help on every page",
    desc: "A support button on every screen, a full user manual with walkthrough videos, and tickets straight to our team.",
  },
];

// What each paid tier adds, in tier order. A tier lists only the features it
// newly unlocks over the tier below.
const TIER_FEATURE_COPY: Record<FeatureKey, string> = {
  automations: "Automated reminders, invoice chasing & review requests",
  campaigns: "Marketing campaigns",
  accounting: "Xero, QuickBooks & Sage sync",
  receptionist: "AI receptionist",
};

const TIER_BLURB: Record<string, string> = {
  starter: "Everything you need to run one site.",
  pro: "Put the follow-up on autopilot.",
  growth: "For groups running several sites.",
};

const gbp = (pence: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: pence % 100 === 0 ? 0 : 2,
  }).format(pence / 100);

function tierLines(tier: TierConfig, below: TierConfig | null): string[] {
  const lines: string[] = [];
  if (below) lines.push(`Everything in ${below.name}, plus:`);
  else lines.push("Bookings, job board & health checks", "Quotes, invoices & card payments", "Customer portal & DVLA/DVSA data");
  for (const key of Object.keys(TIER_FEATURE_COPY) as FeatureKey[]) {
    if (tier.features[key] && !(below?.features[key] ?? false)) lines.push(TIER_FEATURE_COPY[key]);
  }
  return lines;
}

function BetaPill() {
  return (
    <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
      Beta
    </span>
  );
}

function FeatureCard({ icon: Icon, title, desc, beta, heading: Heading = "h3" }: Feature & { heading?: "h3" | "h4" }) {
  return (
    <div className="group relative rounded-2xl border border-white/5 bg-white/[0.03] p-6 backdrop-blur-sm transition-all hover:border-green-500/30 hover:bg-white/[0.06]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-green-600/20 text-green-400">
          <Icon className="h-5 w-5" />
        </div>
        {isBeta(beta) && <BetaPill />}
      </div>
      <Heading className="mb-2 font-semibold">{title}</Heading>
      <p className="text-sm leading-relaxed text-gray-400">{desc}</p>
    </div>
  );
}

function SectionHeading({ eyebrow, title, intro }: { eyebrow: string; title: string; intro: string }) {
  return (
    <div className="mb-10 max-w-2xl">
      <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-green-400">{eyebrow}</p>
      <h3 className="text-2xl font-bold sm:text-3xl">{title}</h3>
      <p className="mt-3 text-gray-400">{intro}</p>
    </div>
  );
}

function QuoteMock() {
  const items = [
    { tone: "bg-red-500", name: "Front brake pads & discs", note: "Pads at 2mm — replace now", price: 18600, approved: true },
    { tone: "bg-amber-400", name: "Wiper blades", note: "Smearing — advise soon", price: 2400, approved: true },
    { tone: "bg-green-500", name: "Tyres", note: "5mm all round", price: null, approved: false },
  ];
  return (
    <div aria-hidden className="mx-auto w-full max-w-[300px] rounded-[2.25rem] border border-white/10 bg-[#14171c] p-2.5 shadow-2xl shadow-green-950/40">
      <div className="rounded-[1.8rem] bg-[#0f1216] px-4 pb-5 pt-6">
        <div className="mx-auto mb-5 h-1.5 w-16 rounded-full bg-white/10" />
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-600 text-xs font-bold">SM</div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">Smith Motors</p>
            <p className="truncate text-xs text-gray-500">Kings Road branch · AB12 CDE</p>
          </div>
        </div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Health check results</p>
        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.name} className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
              <div className="flex items-start gap-2.5">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${it.tone}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-tight">{it.name}</p>
                  <p className="mt-0.5 text-xs text-gray-500">{it.note}</p>
                </div>
                {it.price !== null && <p className="text-sm font-semibold">{gbp(it.price)}</p>}
              </div>
              {it.approved && (
                <div className="mt-2.5 flex items-center gap-1.5 pl-[18px] text-xs text-green-400">
                  <Check className="h-3.5 w-3.5" /> Approved
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-xl bg-green-600 py-2.5 text-center text-sm font-semibold">
          Approve 2 items · {gbp(21000)}
        </div>
      </div>
    </div>
  );
}

export function MarketingLandingPage() {
  const tiers = [TIERS.starter, TIERS.pro, TIERS.growth];
  const featureCount = GROUPS.reduce((n, g) => n + g.features.length, 0);

  return (
    <div className="min-h-screen bg-[#0b0d11] text-white overflow-x-hidden">
      <AnimatedBackground />

      <nav className="relative z-10 flex items-center justify-between gap-4 px-4 py-5 sm:px-6 max-w-6xl mx-auto">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo/aigarage-logo-horizontal-on-dark.svg" alt="AI Garage" className="h-8 w-auto" />
        <div className="hidden items-center gap-6 text-sm text-gray-400 md:flex">
          <a href="#features" className="hover:text-white transition-colors">Features</a>
          <a href="#ai" className="hover:text-white transition-colors">AI</a>
          <a href="#branches" className="hover:text-white transition-colors">Multi-branch</a>
          <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/staff/login"
            className="text-sm text-gray-400 hover:text-white transition-colors px-2 py-1.5 sm:px-3"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="whitespace-nowrap rounded-lg bg-green-600 px-4 py-2 text-sm font-medium hover:bg-green-500 transition-colors"
          >
            Get started free
          </Link>
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative z-10 flex flex-col items-center text-center px-4 sm:px-6 pt-16 pb-20 sm:pt-20">
        <div className="animate-fade-in-up inline-flex items-center gap-2 rounded-full border border-green-500/30 bg-green-500/10 px-4 py-1.5 text-xs text-green-300 mb-8 sm:text-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
          Garage management software for UK independents
        </div>

        <h1 className="animate-fade-in-up max-w-4xl text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-6xl lg:text-7xl" style={{ animationDelay: "0.1s", animationFillMode: "both" }}>
          Run the whole garage.{" "}
          <span className="animate-gradient-x sm:block bg-gradient-to-r from-green-300 via-emerald-300 to-lime-400 bg-clip-text text-transparent">
            Let AI do the typing.
          </span>
        </h1>

        <p className="animate-fade-in-up mt-6 max-w-2xl text-lg text-gray-400" style={{ animationDelay: "0.2s", animationFillMode: "both" }}>
          Bookings, the workshop board, health checks, quotes, invoices and payments — plus MOT reminders, reviews and win-back that run themselves. One system for every branch.
        </p>

        <div className="animate-fade-in-up mt-10 flex flex-wrap justify-center gap-4" style={{ animationDelay: "0.3s", animationFillMode: "both" }}>
          <Link href="/signup" className="rounded-xl bg-green-600 px-8 py-3.5 text-base font-semibold hover:bg-green-500 transition-colors shadow-lg shadow-green-900/50">
            Get started free
          </Link>
          <a href="#features" className="rounded-xl border border-white/10 bg-white/5 px-8 py-3.5 text-base font-semibold hover:bg-white/10 transition-colors backdrop-blur-sm">
            See every feature
          </a>
        </div>
        <p className="animate-fade-in mt-4 text-sm text-gray-500" style={{ animationDelay: "0.4s", animationFillMode: "both" }}>
          Free Starter plan · No card needed · Bring your data from your old system
        </p>

        {/* The journey every visit follows */}
        <div className="animate-fade-in mt-16 w-full max-w-4xl" style={{ animationDelay: "0.5s", animationFillMode: "both" }}>
          <ol className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {JOURNEY.map(({ icon: Icon, label }, i) => (
              <li key={label} className="relative flex flex-col items-center gap-2 rounded-2xl border border-white/5 bg-white/[0.03] px-2 py-4 backdrop-blur-sm">
                <span className="absolute left-3 top-2 text-[10px] font-semibold text-gray-600">{i + 1}</span>
                <Icon className="h-5 w-5 text-green-400" />
                <span className="text-xs font-medium text-gray-300">{label}</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-sm text-gray-500">Every visit flows from booking to paid in one system. Nobody re-types anything.</p>
        </div>
      </section>

      {/* ── Built for the UK ─────────────────────────────────── */}
      <section className="relative z-10 border-y border-white/5 bg-white/[0.02] px-4 sm:px-6 py-6">
        <ul className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-gray-400">
          {PROOF.map((p) => (
            <li key={p} className="flex items-center gap-2">
              <Check className="h-4 w-4 text-green-400" />
              {p}
            </li>
          ))}
        </ul>
      </section>

      {/* ── Feature groups ───────────────────────────────────── */}
      <section id="features" className="relative z-10 scroll-mt-6 px-4 sm:px-6 pt-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-16 text-center">
            <h2 className="text-3xl font-bold sm:text-4xl">Everything your garage needs</h2>
            <p className="mt-4 text-gray-400">{featureCount} tools that work together, from the front desk to the accounts.</p>
          </div>
          <div className="space-y-24">
            {GROUPS.map((g) => (
              <div key={g.id} id={g.id} className="scroll-mt-6">
                <SectionHeading eyebrow={g.eyebrow} title={g.title} intro={g.intro} />
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {g.features.map((f) => (
                    <FeatureCard key={f.title} heading="h4" {...f} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Customer portal ──────────────────────────────────── */}
      <section id="portal" className="relative z-10 scroll-mt-6 px-4 sm:px-6 pt-24">
        <div className="mx-auto grid max-w-6xl items-center gap-12 rounded-3xl border border-white/5 bg-white/[0.02] p-6 sm:p-10 lg:grid-cols-[1fr_auto] lg:gap-16 lg:p-14">
          <div>
            <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-green-400">Customer portal</p>
            <h3 className="text-2xl font-bold sm:text-3xl">Your brand. Your customers. No app to download.</h3>
            <p className="mt-3 max-w-xl text-gray-400">
              Every garage gets its own web address with its logo and colours. Customers see your garage — not ours — and everything they need is a tap away.
            </p>
            <ul className="mt-8 grid gap-3 sm:grid-cols-2">
              {PORTAL_POINTS.map((p) => (
                <li key={p} className="flex gap-3 text-sm text-gray-300">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />
                  {p}
                </li>
              ))}
            </ul>
          </div>
          <QuoteMock />
        </div>
      </section>

      {/* ── AI ───────────────────────────────────────────────── */}
      <section id="ai" className="relative z-10 scroll-mt-6 px-4 sm:px-6 pt-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-green-400">AI built in</p>
            <h2 className="text-3xl font-bold sm:text-4xl">AI that does the typing. You stay in charge.</h2>
            <p className="mx-auto mt-4 max-w-2xl text-gray-400">
              AI handles the paperwork where it piles up — and anything it writes for a message, quote or report stays editable until you send it.
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {AI_FEATURES.map((f) => (
              <FeatureCard key={f.title} {...f} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Multi-branch ─────────────────────────────────────── */}
      <section id="branches" className="relative z-10 scroll-mt-6 px-4 sm:px-6 pt-24">
        <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[2fr_3fr]">
          <div>
            <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-green-400">One site or twenty</p>
            <h2 className="text-3xl font-bold sm:text-4xl">One account, every branch.</h2>
            <p className="mt-4 text-gray-400">
              Switch branches from the top bar. Owners and accountants see the whole business; branch teams see their own workshop.
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            {BRANCH_POINTS.map(({ icon: Icon, title, desc }) => (
              <div key={title}>
                <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-green-600/20 text-green-400">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mb-1.5 font-semibold">{title}</h3>
                <p className="text-sm leading-relaxed text-gray-400">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Switching ────────────────────────────────────────── */}
      <section id="switch" className="relative z-10 scroll-mt-6 px-4 sm:px-6 pt-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-green-400">Switching</p>
            <h2 className="text-3xl font-bold sm:text-4xl">Moving in is the easy part.</h2>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {SWITCH_POINTS.map((f) => (
              <FeatureCard key={f.title} {...f} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ──────────────────────────────────────────── */}
      <section id="pricing" className="relative z-10 scroll-mt-6 px-4 sm:px-6 pt-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-green-400">Pricing</p>
            <h2 className="text-3xl font-bold sm:text-4xl">Start free. Pay less per payment as you grow.</h2>
            <p className="mx-auto mt-4 max-w-2xl text-gray-400">
              Core trading — jobs, invoices and payments — is on every plan. Higher plans unlock automation and more branches, and lower the platform fee on customer payments.
            </p>
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            {tiers.map((t, i) => {
              const featured = t.key === "pro";
              return (
                <div
                  key={t.key}
                  className={`flex flex-col rounded-3xl border p-7 backdrop-blur-sm ${
                    featured ? "border-green-500/40 bg-green-900/20" : "border-white/5 bg-white/[0.03]"
                  }`}
                >
                  <h3 className="text-lg font-semibold">{t.name}</h3>
                  <p className="mt-1 text-sm text-gray-400">{TIER_BLURB[t.key]}</p>
                  <p className="mt-6 flex items-baseline gap-1.5">
                    <span className="text-4xl font-extrabold">{t.monthlyPence === 0 ? "Free" : gbp(t.monthlyPence)}</span>
                    {t.monthlyPence > 0 && <span className="text-sm text-gray-400">/month</span>}
                  </p>
                  <p className="mt-1 h-5 text-xs text-gray-500">
                    {t.annualPence > 0 ? `or ${gbp(t.annualPence)}/year — two months free` : "Free for as long as you like"}
                  </p>
                  <dl className="mt-6 space-y-2 border-y border-white/5 py-4 text-sm">
                    <div className="flex justify-between gap-4">
                      <dt className="text-gray-400">Branches</dt>
                      <dd className="text-right font-medium">
                        {t.maxLocations === 1 ? "1" : `Up to ${t.maxLocations}`}
                        {t.perExtraLocationPence ? ` · then ${gbp(t.perExtraLocationPence)}/mo each` : ""}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-gray-400">Platform fee on payments</dt>
                      <dd className="font-medium">{t.feePercent === 0 ? "None" : `${t.feePercent}%`}</dd>
                    </div>
                  </dl>
                  <ul className="mt-5 flex-1 space-y-2.5 text-sm">
                    {tierLines(t, i > 0 ? tiers[i - 1] : null).map((line, j) => (
                      <li key={line} className={`flex gap-2.5 ${i > 0 && j === 0 ? "text-gray-400" : "text-gray-200"}`}>
                        {!(i > 0 && j === 0) && <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />}
                        {line}
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/signup"
                    className={`mt-7 rounded-xl px-6 py-3 text-center text-sm font-semibold transition-colors ${
                      featured ? "bg-green-600 hover:bg-green-500" : "border border-white/10 bg-white/5 hover:bg-white/10"
                    }`}
                  >
                    {t.monthlyPence === 0 ? "Get started free" : "Start free, upgrade in-app"}
                  </Link>
                </div>
              );
            })}
          </div>
          <p className="mt-6 text-center text-xs text-gray-500">
            Card payments go straight to your own Stripe account. The platform fee applies to customer payments taken through AI Garage, alongside Stripe&apos;s own processing fees.
          </p>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────── */}
      <section className="relative z-10 px-4 sm:px-6 py-24">
        <div className="mx-auto max-w-3xl rounded-3xl border border-green-500/20 bg-gradient-to-br from-green-900/40 to-emerald-900/20 px-6 py-14 text-center backdrop-blur-sm sm:px-8 sm:py-16">
          <h2 className="text-3xl font-bold sm:text-4xl">Ready to run a tighter garage?</h2>
          <p className="mx-auto mt-4 max-w-md text-gray-300">
            Set up on the free plan today. Upgrade when you want the follow-up on autopilot or another branch.
          </p>
          <Link href="/signup" className="mt-8 inline-flex items-center gap-2 rounded-xl bg-green-600 px-10 py-4 text-base font-semibold hover:bg-green-500 transition-colors shadow-lg shadow-green-900/50">
            Get started free <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <footer className="relative z-10 border-t border-white/5 px-4 sm:px-6 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-sm text-gray-600 sm:flex-row">
          <p>© {new Date().getFullYear()} AI Garage · Built for UK garages</p>
          <div className="flex gap-6">
            <Link href="/privacy" className="hover:text-gray-300 transition-colors">Privacy</Link>
            <Link href="/status" className="hover:text-gray-300 transition-colors">Service status</Link>
            <Link href="/staff/login" className="hover:text-gray-300 transition-colors">Staff sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
