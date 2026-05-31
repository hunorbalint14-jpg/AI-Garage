// Normalises CSP violation reports from the two wire formats browsers use:
//  - legacy `application/csp-report`: { "csp-report": { "violated-directive", … } }
//  - Reporting API `application/reports+json`: [{ type:"csp-violation", body:{ … } }]
// Returns a flat, compact shape for logging. Pure — unit-tested separately from
// the route handler.

export type CspViolation = {
  directive: string;
  blockedURI: string;
  documentURI: string;
  sourceFile?: string;
  line?: number;
};

function pickLegacy(r: Record<string, unknown>): CspViolation {
  return {
    directive: String(r["effective-directive"] || r["violated-directive"] || "unknown"),
    blockedURI: String(r["blocked-uri"] || "unknown"),
    documentURI: String(r["document-uri"] || "unknown"),
    sourceFile: r["source-file"] ? String(r["source-file"]) : undefined,
    line: typeof r["line-number"] === "number" ? r["line-number"] : undefined,
  };
}

function pickReportingApi(body: Record<string, unknown>): CspViolation {
  return {
    directive: String(body.effectiveDirective || body.violatedDirective || "unknown"),
    blockedURI: String(body.blockedURL || "unknown"),
    documentURI: String(body.documentURL || "unknown"),
    sourceFile: body.sourceFile ? String(body.sourceFile) : undefined,
    line: typeof body.lineNumber === "number" ? body.lineNumber : undefined,
  };
}

export function parseCspReports(contentType: string, rawBody: string): CspViolation[] {
  if (!rawBody.trim()) return [];
  const parsed = JSON.parse(rawBody);

  // Reporting API: an array of { type, body }.
  if (Array.isArray(parsed)) {
    return parsed
      .filter((r) => r && (r.type === "csp-violation" || r.body))
      .map((r) => pickReportingApi((r.body ?? {}) as Record<string, unknown>));
  }

  // Legacy: { "csp-report": {...} }.
  if (parsed && typeof parsed === "object" && "csp-report" in parsed) {
    return [pickLegacy((parsed["csp-report"] ?? {}) as Record<string, unknown>)];
  }

  // Some browsers POST the report object bare.
  if (parsed && typeof parsed === "object") {
    return [pickLegacy(parsed as Record<string, unknown>)];
  }

  return [];
}
