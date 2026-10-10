import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "erobabe — Premium Adult Entertainment",
    template: "%s | erobabe",
  },
  description: "erobabe — your destination for discovering premium adult entertainment. 18+ adults only.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://erobabe.com"),
  openGraph: {
    type: "website",
    siteName: "erobabe",
    title: "erobabe — Premium Adult Entertainment",
    description: "Your destination for discovering premium adult entertainment. 18+ adults only.",
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: "https://i.postimg.cc/ZnrQD6fN/erobabe-favicon-removebg-preview.png",
    apple: "https://i.postimg.cc/ZnrQD6fN/erobabe-favicon-removebg-preview.png",
  },
  other: {
    rating: "adult",
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
      <body className="min-h-screen bg-void text-ink antialiased">{children}</body>
    </html>
  );
}
