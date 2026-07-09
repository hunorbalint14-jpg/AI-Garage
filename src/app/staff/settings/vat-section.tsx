"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { updateVatSettings } from "./vat-actions";

// VAT & invoice-numbering settings (#451). VAT registration is org-level (the
// legal entity); the invoice prefix is per-branch so multi-site paperwork is
// unambiguous (SMI-INV-0042).
export function VatSection({
  vatRegistered,
  vatNumber,
  activeLocationName,
  invoicePrefix,
  canManage,
}: {
  vatRegistered: boolean;
  vatNumber: string;
  activeLocationName: string;
  invoicePrefix: string;
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [registered, setRegistered] = useState(vatRegistered);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleSubmit(formData: FormData) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateVatSettings(formData);
      if ("error" in result) setError(result.error);
      else {
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      }
    });
  }

  return (
    <section className="rounded-lg border p-5 flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">VAT &amp; invoice numbering</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Applies to every invoice this garage issues. Ask your accountant if you&rsquo;re unsure.
        </p>
      </div>

      <form action={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="vatRegistered">VAT registered</Label>
            <NativeSelect
              id="vatRegistered"
              name="vatRegistered"
              value={registered ? "true" : "false"}
              onChange={(e) => setRegistered(e.target.value === "true")}
              disabled={!canManage || pending}
            >
              <option value="true">Yes — charge VAT on invoices</option>
              <option value="false">No — never charge VAT</option>
            </NativeSelect>
          </div>
          {registered && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="vatNumber">VAT registration number</Label>
              <Input
                id="vatNumber"
                name="vatNumber"
                defaultValue={vatNumber}
                placeholder="GB123456789"
                disabled={!canManage || pending}
              />
              <p className="text-xs text-muted-foreground">Printed on every invoice — a legal requirement for VAT invoices.</p>
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="invoicePrefix">Invoice prefix — {activeLocationName}</Label>
            <Input
              id="invoicePrefix"
              name="invoicePrefix"
              defaultValue={invoicePrefix}
              placeholder="e.g. SMI"
              maxLength={6}
              disabled={!canManage || pending}
            />
            <p className="text-xs text-muted-foreground">
              New documents at this branch are numbered like {invoicePrefix ? `${invoicePrefix.toUpperCase()}-INV-0042` : "INV-0042"}. Existing numbers never change.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={!canManage} loading={pending}>Save VAT settings</Button>
          {saved && <span className="text-sm text-ws-green">Saved.</span>}
          {error && <span className="text-sm text-ws-red">{error}</span>}
        </div>
      </form>
    </section>
  );
}
