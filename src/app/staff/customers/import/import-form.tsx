"use client";

import { useRef, useState, useTransition } from "react";
import { importCSV } from "./actions";
import { Button } from "@/components/ui/button";

const SAMPLE_CSV = `full_name,email,phone,registration,make,model,year,mot_expiry,service_due
John Smith,john@example.com,07700900001,AB12CDE,Ford,Focus,2019,2025-11-30,2025-06-15
John Smith,john@example.com,07700900001,XY21ZZZ,Ford,Transit,2021,2026-03-10,
Jane Doe,jane@example.com,,CD63EFG,Vauxhall,Astra,2013,2025-08-20,2025-08-20`;

type Result =
  | { customersCreated: number; customersSkipped: number; vehiclesAdded: number; totalRows: number; errors: string[] }
  | null;

export function ImportForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setResult(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await importCSV(formData);
      if ("error" in res) {
        setError(res.error);
      } else {
        setResult(res);
        formRef.current?.reset();
      }
    });
  }

  function downloadSample() {
    const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ai-garage-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border p-6 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">CSV format</h2>
          <p className="text-sm text-muted-foreground">
            One row per vehicle. Customers with the same email are merged automatically.
            Dates as <code className="font-mono text-xs">YYYY-MM-DD</code>. Registration normalised automatically.
          </p>
          <button
            type="button"
            onClick={downloadSample}
            className="mt-1 w-fit text-sm underline text-muted-foreground hover:text-foreground"
          >
            Download sample template
          </button>
        </div>

        <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            name="file"
            type="file"
            accept=".csv"
            required
            disabled={pending}
            className="text-sm file:mr-3 file:rounded file:border file:border-black/20 dark:file:border-white/25 file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:font-medium"
          />
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? "Importing…" : "Import"}
            </Button>
          </div>
        </form>

        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}
      </div>

      {result && (
        <div className="rounded-lg border p-6 flex flex-col gap-3">
          <h2 className="text-sm font-medium">Import complete</h2>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div className="flex flex-col gap-0.5">
              <span className="text-2xl font-bold text-green-700">{result.customersCreated}</span>
              <span className="text-muted-foreground">customers created</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-2xl font-bold">{result.customersSkipped}</span>
              <span className="text-muted-foreground">customers matched</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-2xl font-bold text-green-700">{result.vehiclesAdded}</span>
              <span className="text-muted-foreground">vehicles added</span>
            </div>
          </div>
          {result.errors.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-red-600">{result.errors.length} row{result.errors.length !== 1 ? "s" : ""} skipped:</p>
              <ul className="text-xs text-red-600 list-disc list-inside space-y-0.5">
                {result.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
