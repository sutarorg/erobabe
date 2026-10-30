import type { Metadata, Viewport } from "next";
import { getSiteUrl, SITE_OG_IMAGE, SITE_NAME } from "@/lib/site";
import { organizationJsonLd, websiteJsonLd } from "@/lib/seo/json-ld";
import { DEFAULT_SEO } from "@/lib/seo/pages";
import JsonLd from "@/src/components/JsonLd";
import "./globals.css";

const SITE = getSiteUrl();

export const metadata: Metadata = {
  title: {
    default: DEFAULT_SEO.title,
    template: `%s | ${SITE_NAME}`,
  },
  description: DEFAULT_SEO.description,
  keywords: DEFAULT_SEO.keywords,
  metadataBase: new URL(SITE),
  applicationName: SITE_NAME,
  referrer: "origin-when-cross-origin",
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: SITE_NAME,
    title: DEFAULT_SEO.title,
    description: DEFAULT_SEO.description,
    url: SITE,
    images: [SITE_OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: DEFAULT_SEO.title,
    description: DEFAULT_SEO.description,
    images: [SITE_OG_IMAGE],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  /**
   * Self-hosted icons only. Google needs a square icon that Googlebot-Image
   * can fetch from this host, and it stages them in 48 px steps - so list
   * every size we ship instead of one remote image.
   */
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any", type: "image/x-icon" },
      { url: "/icons/icon-48x48.png", sizes: "48x48", type: "image/png" },
      { url: "/icons/icon-96x96.png", sizes: "96x96", type: "image/png" },
      { url: "/icons/icon-144x144.png", sizes: "144x144", type: "image/png" },
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: [{ url: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  manifest: "/manifest.webmanifest",
  other: {
    rating: "adult",
    RATING: "RTA-5042-1996-1400-1577-RTA",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0b0d",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400;14..32,500;14..32,600;14..32,700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-void text-ink antialiased">
        {/* Site name and publisher logo live here, once, so every page agrees. */}
        <JsonLd data={websiteJsonLd(SITE)} />
        <JsonLd data={organizationJsonLd(SITE)} />
        {children}
      </body>
    </html>
  );
}
