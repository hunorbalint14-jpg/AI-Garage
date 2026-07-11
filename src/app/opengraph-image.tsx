import { ImageResponse } from "next/og";
import { getCurrentTenant } from "@/lib/tenant-data";
import { loadMiniSite } from "@/lib/minisite-data";

// Dynamic OG card (#507 PR 3): branded per tenant (accent + name +
// strapline); the apex and unpublished tenants get the platform card.

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OgImage() {
  const tenant = await getCurrentTenant();
  const site = tenant ? await loadMiniSite(tenant.organization.id) : null;

  const name = site?.org.name ?? "AI Garage";
  const strapline = site?.strapline ?? (site ? "MOTs, servicing and repairs — book online." : "The AI-powered garage platform.");
  const accent = site?.org.primaryColor ?? "#6366f1";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background: "#0a0a0a",
          color: "#fafafa",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ width: 120, height: 10, background: accent, borderRadius: 5, marginBottom: 42 }} />
        <div style={{ fontSize: 76, fontWeight: 700, textAlign: "center", padding: "0 80px" }}>{name}</div>
        <div style={{ fontSize: 32, color: "#a3a3a3", marginTop: 24, textAlign: "center", padding: "0 120px" }}>
          {strapline}
        </div>
        <div
          style={{
            marginTop: 48,
            fontSize: 26,
            fontWeight: 600,
            color: "#fff",
            background: accent,
            padding: "14px 36px",
            borderRadius: 10,
            display: "flex",
          }}
        >
          Book online
        </div>
      </div>
    ),
    size,
  );
}
