import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tenant subdomains hit the dev server with a non-localhost Host header,
  // so Next.js' default HMR cross-origin block trips. Allowlist localtest.me
  // and any subdomain for local dev.
  allowedDevOrigins: ["localtest.me", "*.localtest.me"],

  // Move the Next.js dev indicator out of bottom-left so it doesn't overlap
  // the staff sidebar's user info / sign-out button.
  devIndicators: {
    position: "bottom-right",
  },
};

export default nextConfig;
