import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";
import { getPublicCategories, getPublishedVideos } from "@/lib/public/catalog";
import BrowserClient from "./BrowserClient";

export const revalidate = 30;

export const metadata: Metadata = {
  title: "Browse Videos",
  description: "Browse every published video on erobabe.",
  alternates: { canonical: `${SITE_URL}/browser` },
};

export default async function BrowserPage() {
  const [videos, categories] = await Promise.all([getPublishedVideos(), getPublicCategories()]);
  return <BrowserClient videos={videos} categories={categories} />;
}
