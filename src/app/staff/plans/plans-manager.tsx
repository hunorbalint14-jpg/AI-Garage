"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { upsertServicePlan, togglePlanActive, deleteServicePlan } from "./actions";

export type ServiceOption = { id: string; name: string };

export type IncludedItem = { service_id: string; quantity_per_period: number };

export type PlanRow = {
  id: string;
  name: string;
  description: string | null;
  price_monthly_pence: number | null;
  price_annual_pence: number | null;
  stripe_product_id: string | null;
  stripe_price_monthly_id: string | null;
  stripe_price_annual_id: string | null;
  active: boolean;
  discount_type: "none" | "percent" | "fixed";
  discount_value: number;
  included: IncludedItem[];
  subscriberCount: number;
};

const fmt = (pence: number | null) =>
  pence == null
    ? null
    : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);

const fmtPounds = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

function discountLabel(plan: Pick<PlanRow, "discount_type" | "discount_value">): string | null {
  if (plan.discount_type === "percent" && plan.discount_value > 0) return `${plan.discount_value}% member discount`;
  if (plan.discount_type === "fixed" && plan.discount_value > 0) return `${fmtPounds(plan.discount_value)} member discount`;
  return null;
}

type ActionResult = { error: string } | { success: true };

export function PlansManager({ plans, services }: { plans: PlanRow[]; services: ServiceOption[] }) {
  const serviceName = new Map(services.map((s) => [s.id, s.name]));
  const [editing, setEditing] = useState<string | null>(null); // plan id, "new", or null
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<ActionResult>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if ("error" in res) setError(res.error);
      else after?.();
    });
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>, planId?: string) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(() => upsertServicePlan(fd, planId), () => setEditing(null));
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        {editing === "new" ? (
          <PlanForm services={services} onSubmit={(e) => handleSubmit(e)} onCancel={() => setEditing(null)} pending={pending} />
        ) : (
          <Button
            onClick={() => {
              setError(null);
              setEditing("new");
            }}
          >
            Add plan
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {plans.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          No plans yet. Add a recurring maintenance plan to offer memberships.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {plans.map((p) =>
            editing === p.id ? (
              <PlanForm
                key={p.id}
                plan={p}
                services={services}
                onSubmit={(e) => handleSubmit(e, p.id)}
                onCancel={() => setEditing(null)}
                pending={pending}
              />
            ) : (
              <PlanCard
                key={p.id}
                plan={p}
                serviceName={serviceName}
                pending={pending}
                onEdit={() => {
                  setError(null);
                  setEditing(p.id);
                }}
                onToggle={() => run(() => togglePlanActive(p.id, !p.active))}
                onDelete={() => {
                  if (confirm("Delete this plan?")) run(() => deleteServicePlan(p.id));
                }}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function PlanCard({
  plan,
  serviceName,
  pending,
  onEdit,
  onToggle,
  onDelete,
}: {
  plan: PlanRow;
  serviceName: Map<string, string>;
  pending: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const m = fmt(plan.price_monthly_pence);
  const y = fmt(plan.price_annual_pence);
  const priced =
    !!plan.stripe_product_id &&
    (plan.price_monthly_pence == null || !!plan.stripe_price_monthly_id) &&
    (plan.price_annual_pence == null || !!plan.stripe_price_annual_id);

  return (
    <div className={`rounded-lg border p-4 flex flex-col gap-2 ${plan.active ? "" : "opacity-60"}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-medium">{plan.name}</h3>
          {plan.description && <p className="text-sm text-muted-foreground">{plan.description}</p>}
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${plan.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}
        >
          {plan.active ? "Active" : "Inactive"}
        </span>
      </div>

      <div className="text-sm tabular-nums">
        {m && <span className="mr-3">{m}/mo</span>}
        {y && <span>{y}/yr</span>}
      </div>

      {discountLabel(plan) && <p className="text-xs font-medium text-green-700">{discountLabel(plan)}</p>}

      {plan.included.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Includes{" "}
          {plan.included
            .map((i) => `${i.quantity_per_period}× ${serviceName.get(i.service_id) ?? "service"}`)
            .join(", ")}{" "}
          per period
        </p>
      )}

      <div className="text-xs text-muted-foreground">
        {plan.subscriberCount} active subscriber{plan.subscriberCount === 1 ? "" : "s"}
        {!priced && <span className="ml-2 text-amber-600">· Stripe price pending</span>}
      </div>

      <div className="mt-1 flex flex-wrap gap-2">
        <Button variant="outline" onClick={onEdit} disabled={pending}>
          Edit
        </Button>
        <Button variant="outline" onClick={onToggle} disabled={pending}>
          {plan.active ? "Deactivate" : "Activate"}
        </Button>
        <Button variant="destructive" onClick={onDelete} disabled={pending}>
          Delete
        </Button>
      </div>
    </div>
  );
}

function PlanForm({
  plan,
  services,
  onSubmit,
  onCancel,
  pending,
}: {
  plan?: PlanRow;
  services: ServiceOption[];
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const isEdit = !!plan;
  const [included, setIncluded] = useState<IncludedItem[]>(plan?.included ?? []);

  function addIncluded() {
    const used = new Set(included.map((i) => i.service_id));
    const next = services.find((s) => !used.has(s.id));
    if (next) setIncluded([...included, { service_id: next.id, quantity_per_period: 1 }]);
  }
  function updateIncluded(idx: number, patch: Partial<IncludedItem>) {
    setIncluded(included.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function removeIncluded(idx: number) {
    setIncluded(included.filter((_, i) => i !== idx));
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border p-4 flex flex-col gap-3 sm:col-span-2">
      <div className="flex flex-col gap-1">
        <label htmlFor="plan-name" className="text-xs text-muted-foreground">
          Plan name
        </label>
        <Input id="plan-name" name="name" required defaultValue={plan?.name ?? ""} disabled={pending} />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="plan-desc" className="text-xs text-muted-foreground">
          Description (optional)
        </label>
        <textarea
          id="plan-desc"
          name="description"
          rows={2}
          defaultValue={plan?.description ?? ""}
          disabled={pending}
          className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
        />
      </div>

      {isEdit ? (
        <p className="text-xs text-muted-foreground">
          Prices are fixed once a plan is created (Stripe prices cannot change). To reprice, create a new plan.
        </p>
      ) : (
        <div className="flex flex-wrap gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="plan-monthly" className="text-xs text-muted-foreground">
              Monthly price (£)
            </label>
            <Input id="plan-monthly" name="priceMonthly" type="number" step="0.01" min="0" placeholder="—" disabled={pending} className="w-32" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="plan-annual" className="text-xs text-muted-foreground">
              Annual price (£)
            </label>
            <Input id="plan-annual" name="priceAnnual" type="number" step="0.01" min="0" placeholder="—" disabled={pending} className="w-32" />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="plan-discount-type" className="text-xs text-muted-foreground">
            Member discount
          </label>
          <select
            id="plan-discount-type"
            name="discountType"
            defaultValue={plan?.discount_type ?? "none"}
            disabled={pending}
            className="rounded-md border bg-transparent px-3 py-2 text-sm"
          >
            <option value="none">None</option>
            <option value="percent">Percentage</option>
            <option value="fixed">Fixed £</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="plan-discount-value" className="text-xs text-muted-foreground">
            Value (% or £)
          </label>
          <Input
            id="plan-discount-value"
            name="discountValue"
            type="number"
            step="0.01"
            min="0"
            defaultValue={plan && plan.discount_value > 0 ? String(plan.discount_value) : ""}
            placeholder="0"
            disabled={pending}
            className="w-28"
          />
        </div>
      </div>

      {services.length > 0 && (
        <div className="flex flex-col gap-2">
          <input type="hidden" name="includedServices" value={JSON.stringify(included)} />
          <p className="text-xs text-muted-foreground">Included services (covered free, per billing period)</p>
          {included.map((it, idx) => (
            <div key={idx} className="flex flex-wrap items-end gap-2">
              <select
                value={it.service_id}
                onChange={(e) => updateIncluded(idx, { service_id: e.target.value })}
                disabled={pending}
                className="rounded-md border bg-transparent px-3 py-2 text-sm"
              >
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <Input
                type="number"
                min="1"
                step="1"
                value={String(it.quantity_per_period)}
                onChange={(e) => updateIncluded(idx, { quantity_per_period: Math.max(1, parseInt(e.target.value || "1", 10)) })}
                disabled={pending}
                className="w-20"
                aria-label="Quantity per period"
              />
              <Button type="button" variant="outline" onClick={() => removeIncluded(idx)} disabled={pending}>
                Remove
              </Button>
            </div>
          ))}
          {included.length < services.length && (
            <div>
              <Button type="button" variant="outline" onClick={addIncluded} disabled={pending}>
                Add included service
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : isEdit ? "Save" : "Create plan"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
