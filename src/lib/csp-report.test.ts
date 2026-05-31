import { describe, it, expect } from "vitest";
import { parseCspReports } from "./csp-report";

describe("parseCspReports", () => {
  it("parses a legacy application/csp-report body", () => {
    const body = JSON.stringify({
      "csp-report": {
        "document-uri": "https://x.ai-garage.co.uk/staff",
        "violated-directive": "script-src",
        "effective-directive": "script-src",
        "blocked-uri": "https://evil.example/x.js",
        "source-file": "https://x.ai-garage.co.uk/staff",
        "line-number": 42,
      },
    });
    expect(parseCspReports("application/csp-report", body)).toEqual([
      {
        directive: "script-src",
        blockedURI: "https://evil.example/x.js",
        documentURI: "https://x.ai-garage.co.uk/staff",
        sourceFile: "https://x.ai-garage.co.uk/staff",
        line: 42,
      },
    ]);
  });

  it("parses a Reporting API application/reports+json array", () => {
    const body = JSON.stringify([
      {
        type: "csp-violation",
        body: {
          documentURL: "https://x.ai-garage.co.uk/book",
          effectiveDirective: "img-src",
          blockedURL: "https://cdn.evil/x.png",
        },
      },
    ]);
    const out = parseCspReports("application/reports+json", body);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      directive: "img-src",
      blockedURI: "https://cdn.evil/x.png",
      documentURI: "https://x.ai-garage.co.uk/book",
    });
  });

  it("handles a bare report object", () => {
    const body = JSON.stringify({
      "effective-directive": "connect-src",
      "blocked-uri": "wss://evil",
      "document-uri": "https://x/y",
    });
    expect(parseCspReports("application/json", body)[0]).toMatchObject({
      directive: "connect-src",
      blockedURI: "wss://evil",
    });
  });

  it("returns empty for blank body", () => {
    expect(parseCspReports("application/json", "")).toEqual([]);
    expect(parseCspReports("application/json", "   ")).toEqual([]);
  });

  it("throws on malformed JSON (caller catches)", () => {
    expect(() => parseCspReports("application/json", "{not json")).toThrow();
  });
});
