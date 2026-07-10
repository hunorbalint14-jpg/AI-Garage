"use client";

import { useRef, useState } from "react";
import { Upload, FileCheck2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TARGET_FIELDS, type ColumnMapping, type ImportKind } from "@/lib/import-engine";
import { analyzeImport, commitImport, type AnalyzeResult, type CommitResult } from "./wizard-actions";

// Import wizard (#505 PR 2): kind + file → mapping (auto-matched, editable) →
// dry-run preview (counts + row rejects) → commit. The file is re-submitted
// with every action; the preview and the commit run the same pipeline.

const KINDS: { key: ImportKind; label: string; blurb: string }[] = [
  { key: "customers", label: "Customers & vehicles", blurb: "Names, contact details and their vehicles." },
  { key: "history", label: "Service history", blurb: "Past work per vehicle — date, mileage, description, total." },
  { key: "reminders", label: "Reminder dates", blurb: "MOT / service / tax due dates onto existing vehicles." },
];

type Analysis = Exclude<AnalyzeResult, { error: string }>;
type Committed = Exclude<CommitResult, { error: string }>;

const COUNT_LABEL: Record<string, string> = {
  entries: "history entries",
  vehicles: "vehicles",
  customers: "new customers",
  mot_dates: "MOT dates",
  service_dates: "service dates",
  tax_dates: "tax dates",
};

export function ImportWizard() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<ImportKind>("customers");
  const [overwrite, setOverwrite] = useState(false);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [committed, setCommitted] = useState<Committed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"analyze" | "commit" | null>(null);

  function buildForm(withMapping: ColumnMapping | null): FormData | null {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a CSV file first.");
      return null;
    }
    const fd = new FormData();
    fd.set("file", file);
    fd.set("kind", kind);
    fd.set("overwrite", String(overwrite));
    if (withMapping) fd.set("mapping", JSON.stringify(withMapping));
    return fd;
  }

  async function runAnalyze(withMapping: ColumnMapping | null) {
    const fd = buildForm(withMapping);
    if (!fd) return;
    setError(null);
    setCommitted(null);
    setBusy("analyze");
    const res = await analyzeImport(fd);
    setBusy(null);
    if ("error" in res) return setError(res.error);
    setAnalysis(res);
    setMapping(res.mapping);
  }

  async function runCommit() {
    const fd = buildForm(mapping);
    if (!fd) return;
    setError(null);
    setBusy("commit");
    const res = await commitImport(fd);
    setBusy(null);
    if ("error" in res) return setError(res.error);
    setCommitted(res);
    setAnalysis(null);
    setMapping(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  const fields = TARGET_FIELDS[kind];
  const readyToCommit = analysis !== null && analysis.missing.length === 0;

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      {/* Step 1: kind + file */}
      <section className="rounded-lg border p-4 flex flex-col gap-3">
        <h2 className="text-sm font-semibold">1 · What are you importing?</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          {KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              onClick={() => {
                setKind(k.key);
                setAnalysis(null);
                setMapping(null);
                setCommitted(null);
              }}
              className={`rounded-md border p-3 text-left text-sm transition-colors ${
                kind === k.key ? "border-primary bg-primary/10" : "hover:bg-muted/40"
              }`}
            >
              <span className="font-semibold">{k.label}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{k.blurb}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            onChange={() => {
              setAnalysis(null);
              setMapping(null);
              setCommitted(null);
              setError(null);
            }}
            className="text-sm file:mr-3 file:rounded-md file:border file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:font-medium"
          />
          <Button size="sm" onClick={() => void runAnalyze(null)} loading={busy === "analyze"} disabled={busy !== null}>
            <Upload className="mr-1.5 h-3.5 w-3.5" /> Preview import
          </Button>
        </div>
        {kind === "reminders" && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} className="h-4 w-4 accent-current" />
            Overwrite dates a vehicle already has (default: only fill blanks)
          </label>
        )}
      </section>

      {/* Step 2: mapping */}
      {analysis && mapping && (
        <section className="rounded-lg border p-4 flex flex-col gap-3">
          <h2 className="text-sm font-semibold">2 · Column mapping</h2>
          <p className="text-xs text-muted-foreground">
            Auto-matched from your file&apos;s headers — fix anything that&apos;s wrong, then preview again.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {fields.map((f) => (
              <label key={f.key} className="flex items-center justify-between gap-3 text-sm">
                <span>
                  {f.label}
                  {f.required && <span className="text-ws-red"> *</span>}
                </span>
                <select
                  value={mapping[f.key] ?? ""}
                  onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value || null })}
                  className="w-44 rounded-md border bg-transparent px-2 py-1.5 text-sm text-foreground"
                >
                  <option value="">— not in file —</option>
                  {analysis.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div>
            <Button size="sm" variant="outline" onClick={() => void runAnalyze(mapping)} loading={busy === "analyze"} disabled={busy !== null}>
              Re-run preview with this mapping
            </Button>
          </div>
        </section>
      )}

      {/* Step 3: dry-run report */}
      {analysis && (
        <section className="rounded-lg border p-4 flex flex-col gap-3">
          <h2 className="text-sm font-semibold">3 · Preview — nothing is saved yet</h2>
          {analysis.missing.length > 0 ? (
            <p className="flex items-center gap-2 text-sm text-ws-amber">
              <AlertTriangle className="h-4 w-4" /> Map the required columns first: {analysis.missing.join(", ")}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-md border px-2.5 py-1 text-sm">{analysis.totalRows} rows in file</span>
                {Object.entries(analysis.counts).map(([k, v]) => (
                  <span key={k} className="rounded-md border border-ws-green/40 bg-ws-green/10 px-2.5 py-1 text-sm">
                    {v} {COUNT_LABEL[k] ?? k}
                  </span>
                ))}
                {analysis.rejects.length > 0 && (
                  <span className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-sm">
                    {analysis.rejects.length} rows will be skipped
                  </span>
                )}
              </div>
              {analysis.rejects.length > 0 && (
                <div className="max-h-56 overflow-y-auto rounded-md border">
                  <table className="w-full text-sm">
                    <tbody>
                      {analysis.rejects.map((r) => (
                        <tr key={`${r.row}-${r.reason}`} className="border-b last:border-0">
                          <td className="w-20 px-3 py-1.5 font-mono text-xs text-muted-foreground">row {r.row}</td>
                          <td className="px-3 py-1.5">{r.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div>
                <Button size="sm" onClick={() => void runCommit()} loading={busy === "commit"} disabled={busy !== null || !readyToCommit}>
                  Import now
                </Button>
              </div>
            </>
          )}
        </section>
      )}

      {committed && (
        <section className="rounded-lg border border-ws-green/40 bg-ws-green/10 p-4 text-sm">
          <p className="flex items-center gap-2 font-semibold">
            <FileCheck2 className="h-4 w-4" /> Import complete
          </p>
          <p className="mt-1">
            {committed.imported} imported · {committed.rejected} skipped
            {committed.rejected > 0 && " (same rows the preview flagged)"}
          </p>
        </section>
      )}

      {error && <p className="text-sm text-ws-red">{error}</p>}
    </div>
  );
}
