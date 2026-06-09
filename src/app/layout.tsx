import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { CookieBanner } from "@/components/cookie-banner";
import { ImpersonationBanner } from "@/components/impersonation-banner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "AI Garage",
    template: "%s · AI Garage",
  },
  description: "AI-powered garage management for independent UK workshops.",
  applicationName: "AI Garage",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/brand/icon/aigarage-favicon.svg", type: "image/svg+xml" },
      { url: "/brand/icon/png/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/icon/png/favicon-192.png", sizes: "192x192", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: [
      { url: "/brand/icon/png/apple-touch-icon.png", sizes: "180x180" },
      { url: "/brand/icon/png/apple-touch-icon-167.png", sizes: "167x167" },
      { url: "/brand/icon/png/apple-touch-icon-152.png", sizes: "152x152" },
    ],
  },
  openGraph: {
    title: "AI Garage",
    description: "AI-powered garage management for independent UK workshops.",
    siteName: "AI Garage",
    type: "website",
    images: [
      { url: "/brand/icon/png/apple-app-store-1024.png", width: 1024, height: 1024, alt: "AI Garage" },
    ],
  },
  twitter: {
    card: "summary",
    title: "AI Garage",
    description: "AI-powered garage management for independent UK workshops.",
    images: ["/brand/icon/png/apple-app-store-1024.png"],
  },
  other: {
    "msapplication-TileColor": "#22c55e",
    "msapplication-TileImage": "/brand/icon/png/favicon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0d11" },
    { media: "(prefers-color-scheme: light)", color: "#22c55e" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <ImpersonationBanner />
        <CookieBanner />
        {/* Real-user TTFB/LCP/CLS per route → Vercel dashboard. Script + beacon
            are same-origin (/_vercel/speed-insights/*), so the CSP needs no change. */}
        <SpeedInsights />
      </body>
    </html>
  );
}
