import { createHash } from "crypto";

// First-party traffic analytics helpers (#admin/traffic PR 1). Pure functions —
// the collect route composes them. Privacy rules live here:
//   - visitor identity is a DAILY-rotating salted hash; raw IP never persisted
//   - paths are normalised so share-link slugs/tokens never reach the DB
//   - referrers are reduced to a host; same-host referrers are dropped

export type TrafficSurface = "marketing" | "booking" | "portal" | "docs" | "staff" | "other";

export type ParsedUa = {
  device: "mobile" | "tablet" | "desktop" | "unknown";
  browser: string;
  os: string;
  isBot: boolean;
};

// ── Visitor hash ────────────────────────────────────────────────────────────
// sha256(secret ∥ utc-day ∥ ip ∥ ua ∥ host). The utc-day term rotates the salt
// at midnight, so a visitor cannot be counted across days (Plausible's model);
// the secret term stops rainbow lookups of known IP+UA pairs.

export function visitorHash(secret: string, utcDay: string, ip: string, ua: string, host: string): string {
  return createHash("sha256").update(`${secret}|${utcDay}|${ip}|${ua}|${host}`).digest("hex").slice(0, 32);
}

export function utcDayString(now: Date): string {
  return now.toISOString().slice(0, 10);
}

// ── Path normalisation ──────────────────────────────────────────────────────
// Token-gated public routes carry their access token in the path — those
// segments are ALWAYS masked, even when they look like readable slugs. Beyond
// that, uuid / long-hex / numeric segments are masked generically so staff
// deep links (/staff/jobs/<uuid>) fold together too.

const TOKEN_PREFIXES = new Set([
  "quote", "invoice", "pay", "authorise", "review", "check", "docs", "plan", "confirm", "b",
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEXY_RE = /^[0-9a-zA-Z_-]{16,}$/; // share slugs, base64url tokens
const NUM_RE = /^\d+$/;

export function normalizePath(rawPath: string): string {
  let path = rawPath.split("?")[0].split("#")[0];
  if (!path.startsWith("/")) path = `/${path}`;
  const segs = path.split("/").filter(Boolean).slice(0, 6);
  const out: string[] = [];
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i].slice(0, 60);
    const prev = i > 0 ? out[i - 1] : "";
    if (i > 0 && TOKEN_PREFIXES.has(prev)) {
      out.push(prev === "invoice" || prev === "pay" || prev === "confirm" ? ":id" : ":slug");
    } else if (UUID_RE.test(seg) || HEXY_RE.test(seg)) {
      out.push(":id");
    } else if (NUM_RE.test(seg)) {
      out.push(":n");
    } else {
      out.push(seg.toLowerCase());
    }
  }
  return `/${out.join("/")}`.slice(0, 200) || "/";
}

// ── Surface classification ──────────────────────────────────────────────────
// hasTenant distinguishes a tenant subdomain's root (their mini-site) from the
// platform marketing site on the root domain — both are "marketing".

export function classifySurface(normalizedPath: string): TrafficSurface {
  const first = normalizedPath.split("/")[1] ?? "";
  switch (first) {
    case "staff":
      return "staff";
    case "book":
    case "confirm":
      return "booking";
    case "dashboard":
    case "login":
    case "register":
    case "plan":
      return "portal";
    case "quote":
    case "invoice":
    case "pay":
    case "authorise":
    case "review":
    case "check":
    case "docs":
      return "docs";
    case "":
    case "b":
    case "pricing":
    case "status":
      return "marketing";
    default:
      return "other";
  }
}

// ── Referrer ────────────────────────────────────────────────────────────────

// rootDomain is the configured platform root (e.g. "ai-garage.co.uk") — never
// derived from the host by label-counting, which mangles eTLDs like co.uk.
export function referrerHost(referrer: string | null | undefined, rootDomain: string): string | null {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.toLowerCase();
    if (!host) return null;
    const root = rootDomain.split(":")[0].toLowerCase();
    // Any host under our root domain is internal navigation, not a referral.
    if (root && (host === root || host.endsWith(`.${root}`))) return null;
    return host.slice(0, 100);
  } catch {
    return null;
  }
}

// ── User agent ──────────────────────────────────────────────────────────────
// Deliberately coarse: device class + major browser + OS family is all the
// dashboard shows. Not a fingerprinting surface — the parse result is shared
// by thousands of visitors.

const BOT_RE =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|whatsapp|telegram|skypeuripreview|discordbot|pinterest|embedly|quora|vkshare|snapchat|headless|lighthouse|gtmetrix|pingdom|uptime|monitor|synthetic|curl|wget|python-requests|python-httpx|go-http-client|okhttp|axios|node-fetch|undici|dataprovider|preview/i;

export function parseUserAgent(ua: string | null | undefined): ParsedUa {
  if (!ua) return { device: "unknown", browser: "unknown", os: "unknown", isBot: true };
  if (BOT_RE.test(ua)) return { device: "unknown", browser: "unknown", os: "unknown", isBot: true };

  const isTablet = /iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua));
  const isMobile = !isTablet && /Mobi|iPhone|iPod|Android|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const device = isTablet ? "tablet" : isMobile ? "mobile" : "desktop";

  let os = "unknown";
  if (/Windows/i.test(ua)) os = "Windows";
  else if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
  else if (/Mac OS X|Macintosh/i.test(ua)) os = "macOS";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/CrOS/i.test(ua)) os = "ChromeOS";
  else if (/Linux/i.test(ua)) os = "Linux";

  let browser = "unknown";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/SamsungBrowser/i.test(ua)) browser = "Samsung Internet";
  else if (/OPR\/|Opera/i.test(ua)) browser = "Opera";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Chrome\/|CriOS/i.test(ua)) browser = "Chrome";
  else if (/Safari\//i.test(ua)) browser = "Safari";

  if (browser !== "unknown" && device !== "desktop") browser = `${browser} ${device === "tablet" ? "Tablet" : "Mobile"}`;
  return { device, browser, os, isBot: false };
}

// ── Geo headers ─────────────────────────────────────────────────────────────
// Vercel injects x-vercel-ip-country / -country-region / -city at the edge.
// City arrives URI-encoded ("S%C3%A3o%20Paulo").

export function geoFromHeaders(get: (name: string) => string | null): {
  country: string | null;
  region: string | null;
  city: string | null;
} {
  const dec = (v: string | null): string | null => {
    if (!v) return null;
    try {
      return decodeURIComponent(v).slice(0, 80);
    } catch {
      return v.slice(0, 80);
    }
  };
  return {
    country: dec(get("x-vercel-ip-country")),
    region: dec(get("x-vercel-ip-country-region")),
    city: dec(get("x-vercel-ip-city")),
  };
}
