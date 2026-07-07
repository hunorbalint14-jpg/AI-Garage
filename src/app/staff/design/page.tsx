import { notFound } from "next/navigation";
import {
  WorkshopBadge,
  ChipButton,
  Plate,
  MicroLabel,
  Segmented,
  type WorkshopTone,
} from "@/components/staff/workshop";

const TONES: WorkshopTone[] = ["amber", "green", "red", "blue", "purple", "neutral"];

// Dev-only living styleguide for the workshop kit (UX review §1b).
// Not linked from the nav; hidden in production.
export default function WorkshopKitPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-8">
      <div>
        <MicroLabel>Workshop kit · dev styleguide</MicroLabel>
        <h1 className="mt-1 text-xl font-semibold text-ws-text">Tokens + components</h1>
      </div>

      <section className="rounded-md border border-ws-border bg-ws-card p-5">
        <MicroLabel className="mb-3">WorkshopBadge — one set, every screen</MicroLabel>
        <div className="flex flex-wrap gap-2">
          {TONES.map((tone) => (
            <WorkshopBadge key={tone} tone={tone}>
              {tone === "neutral" ? "draft" : tone}
            </WorkshopBadge>
          ))}
        </div>
      </section>

      <section className="rounded-md border border-ws-border bg-ws-card p-5">
        <MicroLabel className="mb-3">ChipButton — 3-level hierarchy</MicroLabel>
        <div className="flex flex-wrap items-center gap-4">
          <ChipButton variant="primary" href="#">
            + New booking
          </ChipButton>
          <ChipButton variant="secondary" href="#">
            Export CSV
          </ChipButton>
          <ChipButton variant="quiet" href="#">
            view history →
          </ChipButton>
        </div>
      </section>

      <section className="rounded-md border border-ws-border bg-ws-card p-5">
        <MicroLabel className="mb-3">Plate</MicroLabel>
        <div className="flex flex-wrap gap-2">
          <Plate reg="AB19 CDE" />
          <Plate reg="YC68 NPF" />
        </div>
      </section>

      <section className="rounded-md border border-ws-border bg-ws-card p-5">
        <MicroLabel className="mb-3">Segmented — href mode</MicroLabel>
        <Segmented
          value="day"
          items={[
            { value: "day", label: "Day", href: "#day" },
            { value: "week", label: "Week", href: "#week" },
            { value: "month", label: "Month", href: "#month" },
          ]}
        />
      </section>

      <section className="rounded-md border border-ws-border bg-ws-card p-5">
        <MicroLabel className="mb-3">Surfaces</MicroLabel>
        <div className="flex flex-wrap gap-3">
          {(
            [
              ["rail", "bg-ws-rail"],
              ["page", "bg-ws-page"],
              ["card", "bg-ws-card"],
              ["hover", "bg-ws-hover"],
              ["border", "bg-ws-border"],
            ] as const
          ).map(([name, cls]) => (
            <div key={name} className="text-center">
              <div className={`h-14 w-24 rounded-[3px] border border-ws-border ${cls}`} />
              <div className="mt-1 font-mono text-[10px] text-ws-text-3">{name}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
