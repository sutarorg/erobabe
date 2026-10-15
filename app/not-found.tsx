import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return <main className="mx-auto max-w-xl px-6 py-20 text-center">
    <h1 className="text-2xl font-semibold">Page not found</h1>
    <p className="mt-3">This page may have moved or is no longer available.</p>
    <Link href="/" className="mt-6 inline-block underline">Return to Erobabe</Link>
  </main>;
}
