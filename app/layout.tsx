import type { Metadata } from "next";
import { getSiteUrl } from "@/lib/site";
import { websiteJsonLd } from "@/lib/seo/json-ld";
import JsonLd from "@/src/components/JsonLd";
import "./globals.css";

const SITE = getSiteUrl();

export const metadata: Metadata = {
  title: {
    default: "erobabe — Adult Videos for 18+",
    template: "%s | erobabe",
  },
  description:
    "Watch adult videos on erobabe. Browse categories, latest uploads, and popular scenes. 18+ only.",
  metadataBase: new URL(SITE),
  applicationName: "erobabe",
  referrer: "origin-when-cross-origin",
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "erobabe",
    title: "erobabe — Adult Videos for 18+",
    description:
      "Watch adult videos on erobabe. Browse categories, latest uploads, and popular scenes. 18+ only.",
    url: SITE,
  },
  twitter: {
    card: "summary_large_image",
    title: "erobabe — Adult Videos for 18+",
    description:
      "Watch adult videos on erobabe. Browse categories, latest uploads, and popular scenes. 18+ only.",
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
  icons: {
    icon: "https://i.postimg.cc/ZnrQD6fN/erobabe-favicon-removebg-preview.png",
    apple: "https://i.postimg.cc/ZnrQD6fN/erobabe-favicon-removebg-preview.png",
  },
  other: {
    rating: "adult",
    RATING: "RTA-5042-1996-1400-1577-RTA",
  },
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
        <JsonLd data={websiteJsonLd(SITE)} />
        {children}
      </body>
    </html>
  );
}
