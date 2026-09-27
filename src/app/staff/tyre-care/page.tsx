import Link from "next/link";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasPermission } from "@/lib/permissions";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { garageLabel } from "@/lib/garage-identity";
import type { Evidence, ServiceType } from "@/lib/tyre-care";
import { SERVICE_LABEL, standardDraft } from "@/lib/tyre-care-messages";
import { loadContactStates } from "@/lib/tyre-care-contact";
import { TyreCareList, type QueueItem } from "./tyre-care-list";

// Tyre-care review queue (#596). Recommendations the nightly check raised for
// customers whose home branch is this one, each with the evidence it rests
// on. Staff review, edit and send them — or dismiss with a reason, which is
// the false-positive signal the thresholds are tuned against.

export const dynamic = "force-dynamic";

const TABS = [
  { status: "pending_review", label: "To review" },
  { status: "approved_sent", label: "Sent" },
  { status: "converted", label: "Booked" },
  { status: "dismissed", label: "Dismissed" },
  { status: "expired", label: "No longer due" },
] as const;
type TabStatus = (typeof TABS)[number]["status"];

const EMPTY_TEXT: Record<TabStatus, string> = {
  pending_review: "Nothing to review. The nightly check adds vehicles here when a rotation or alignment is genuinely due.",
  approved_sent: "Nothing sent yet.",
  converted: "No bookings from tyre-care messages yet.",
  dismissed: "No dismissed recommendations.",
  expired: "Nothing has lapsed — items move here when the evidence behind them no longer holds.",
};

/** An MOT this close is the better moment to raise tyre care (spec: bundle with MOT). */
const MOT_BUNDLE_DAYS = 45;

type Row = {
  id: string;
  service_type: ServiceType;
  confidence: "high" | "low";
  evidence: Evidence;
  status: TabStatus;
  dismissed_reason: string | null;
  created_at: string;
  sent_at: string | null;
  converted_at: string | null;
  customer: {
    id: string;
    full_name: string | null;
    email: string | null;
    phone: string | null;
    marketing_email_consent: boolean;
    marketing_sms_consent: boolean;
    anonymized_at: string | null;
  } | null;
  vehicle: {
    id: string;
    registration: string | null;
    make: string | null;
    model: string | null;
    mot_expiry: string | null;
  } | null;
};

function daysFromNow(date: string | null): number | null {
  if (!date) return null;
  const t = Date.parse(date);
  return Number.isFinite(t) ? Math.ceil((t - Date.now()) / 86_400_000) : null;
}

function daysAgo(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000));
}

function ago(iso: string): string {
  const d = daysAgo(iso);
  return d === 0 ? "today" : d === 1 ? "1 day ago" : `${d} days ago`;
}

function channelState(hasAddress: boolean, consent: boolean, kind: "email" | "phone") {
  if (!hasAddress) return { available: false, blocked: kind === "email" ? "no email address" : "no mobile number" };
  if (!consent) return { available: false, blocked: "no marketing consent" };
  return { available: true, blocked: null };
}

export default async function TyreCarePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const ctx = await requireStaffContext();

  if (!(await isFeatureEnabled("tyre_care"))) {
    return (
      <div className="flex flex-col gap-2 max-w-xl">
        <h1 className="text-2xl font-bold">Tyre care</h1>
        <p className="text-sm text-muted-foreground">
          Tyre-care recommendations aren&apos;t switched on for your account yet.
        </p>
      </div>
    );
  }

  if (!hasPermission(ctx, "reminders")) {
    return (
      <div className="flex flex-col gap-2 max-w-xl">
        <h1 className="text-2xl font-bold">Tyre care</h1>
        <p className="text-sm text-muted-foreground">You don&apos;t have access to customer reminders.</p>
      </div>
    );
  }

  const admin = createAdminClient();
  const { status: statusParam } = await searchParams;
  const status: TabStatus = TABS.some((t) => t.status === statusParam)
    ? (statusParam as TabStatus)
    : "pending_review";

  const [{ data: rowsData }, { count: pendingCount }, { data: loc }] = await Promise.all([
    admin
      .from("tyre_recommendations")
      .select(
        "id, service_type, confidence, evidence, status, dismissed_reason, created_at, sent_at, converted_at, customer:customers(id, full_name, email, phone, marketing_email_consent, marketing_sms_consent, anonymized_at), vehicle:vehicles(id, registration, make, model, mot_expiry)",
      )
      .eq("location_id", ctx.location.id)
      .eq("status", status)
      .order(status === "approved_sent" ? "sent_at" : status === "converted" ? "converted_at" : "created_at", {
        ascending: false,
      })
      .limit(200),
    admin
      .from("tyre_recommendations")
      .select("id", { count: "exact", head: true })
      .eq("location_id", ctx.location.id)
      .eq("status", "pending_review"),
    admin.from("locations").select("name").eq("id", ctx.location.id).maybeSingle(),
  ]);

  // Anonymised customers are never contacted; don't show them work to do.
  const rows = ((rowsData ?? []) as unknown as Row[])
    .filter((r) => r.customer && !r.customer.anonymized_at && r.vehicle)
    .sort((a, b) =>
      status === "pending_review" && a.confidence !== b.confidence ? (a.confidence === "high" ? -1 : 1) : 0,
    );

  const pending = status === "pending_review";

  // Wheel setup is read live: staff often confirm it after the item is raised.
  const rotationVehicleIds = pending
    ? [...new Set(rows.filter((r) => r.service_type === "rotation").map((r) => r.vehicle!.id))]
    : [];
  const [{ data: profiles }, contactStates] = await Promise.all([
    rotationVehicleIds.length
      ? admin.from("vehicle_wheel_profile").select("vehicle_id, tyre_config").in("vehicle_id", rotationVehicleIds)
      : Promise.resolve({ data: [] }),
    pending ? loadContactStates(admin, rows.map((r) => r.customer!.id)) : Promise.resolve(new Map()),
  ]);
  const confirmedSetup = new Set(
    ((profiles ?? []) as { vehicle_id: string; tyre_config: string }[])
      .filter((p) => p.tyre_config === "standard")
      .map((p) => p.vehicle_id),
  );

  const label = garageLabel({
    orgName: ctx.organization.name,
    locationName: (loc as { name: string } | null)?.name ?? null,
  });

  const items: QueueItem[] = rows.map((r) => {
    const customer = r.customer!;
    const vehicle = r.vehicle!;
    const registration = vehicle.registration ?? "—";
    const makeModel = [vehicle.make, vehicle.model].filter(Boolean).join(" ");
    const motIn = daysFromNow(vehicle.mot_expiry);
    const cap = contactStates.get(customer.id)?.cap;
    return {
      id: r.id,
      status: r.status,
      serviceLabel: SERVICE_LABEL[r.service_type],
      confidence: r.confidence,
      reason: r.evidence.reason,
      dismissedReason: r.dismissed_reason,
      ageLabel: ago(r.created_at),
      eventLabel:
        r.status === "approved_sent" && r.sent_at
          ? `Sent ${ago(r.sent_at)}`
          : r.status === "converted" && r.converted_at
            ? `Booked ${ago(r.converted_at)}${r.sent_at ? `, ${Math.max(0, daysAgo(r.sent_at) - daysAgo(r.converted_at))} days after the message` : ""}`
            : null,
      customerName: customer.full_name ?? "Customer",
      customerHref: `/staff/customers/${customer.id}`,
      registration,
      makeModel,
      vehicleHref: `/staff/customers/${customer.id}/vehicles/${vehicle.id}/edit`,
      needsSetup: r.service_type === "rotation" && !confirmedSetup.has(vehicle.id),
      motInDays: motIn !== null && motIn >= 0 && motIn <= MOT_BUNDLE_DAYS ? motIn : null,
      email: channelState(Boolean(customer.email), customer.marketing_email_consent, "email"),
      sms: channelState(Boolean(customer.phone), customer.marketing_sms_consent, "phone"),
      cap: cap && !cap.allowed ? { allowed: false, reason: cap.reason } : { allowed: true, reason: null },
      draft: standardDraft({
        firstName: customer.full_name?.split(" ")[0] ?? "there",
        registration,
        vehicleName: makeModel || null,
        serviceType: r.service_type,
        evidence: r.evidence,
        garageLabel: label,
      }),
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">
          Tyre care
          <span className="ml-2 rounded border border-[#5a4218] bg-[#3a2c14] px-1 py-px align-middle font-mono text-[8px] tracking-[.1em] text-[#ffb020]">
            BETA
          </span>
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Rotation and alignment recommendations raised overnight for customers of this branch, each with the evidence
          behind it. Review the message and send it, or dismiss anything that doesn&apos;t look right — your reasons
          tune the thresholds. The nightly check and its intervals live under{" "}
          <Link href="/staff/automations" className="underline underline-offset-2">
            Automations
          </Link>
          .
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link
            key={t.status}
            href={t.status === "pending_review" ? "/staff/tyre-care" : `/staff/tyre-care?status=${t.status}`}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              t.status === status ? "bg-muted font-semibold" : "text-muted-foreground hover:bg-muted/40"
            }`}
          >
            {t.label}
            {t.status === "pending_review" && (pendingCount ?? 0) > 0 && (
              <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 font-mono text-xs">{pendingCount}</span>
            )}
          </Link>
        ))}
      </div>

      <TyreCareList items={items} emptyText={EMPTY_TEXT[status]} />
    </div>
  );
}
