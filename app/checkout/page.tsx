import type { Metadata } from "next";
import CheckoutForm from "./CheckoutForm";
import { loadInventory, type InventorySlot } from "@/lib/ads/inventory";
import { PAYMENT_PANEL_ARTWORK_PATH } from "@/lib/ads/payment";
import { SITE_URL } from "@/lib/site";
import { publicPageMetadata } from "@/lib/metadata/page";

export const dynamic = "force-dynamic";

/**
 * The advertising page is a landing page in its own right: it is listed in
 * sitemap.xml, so it is indexable and carries copy written for people
 * searching for banner inventory rather than just a wizard title.
 */
export const metadata: Metadata = publicPageMetadata({
  title: { absolute: "Advertise on EroBabe" },
  description:
    "Advertise on EroBabe with premium image banner placements on a fast-loading HD porn site. Reach a high-intent adult audience and get your banner seen. Advertise on EroBabe today!",
  keywords: [
    "advertise on EroBabe",
    "adult banner advertising",
    "porn site banner ads",
    "image banner ads",
    "banner ad placements",
    "adult banner space",
    "buy banner traffic",
    "adult traffic",
    "banner advertising on porn sites",
    "adult ad placements",
    "CPM rates",
    "banner ad specs",
    "adult media kit",
    "high-intent adult traffic",
  ],
  alternates: { canonical: `${SITE_URL}/checkout` },
});

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ slot?: string }>;
}) {
  const { slot } = await searchParams;
  const requestedSlot = Number(slot);
  let slots: InventorySlot[] = [];
  let loadError = "";

  try {
    // A sold placement shows its running ad, but only once that ad is public:
    // a submission still in review must not leak its creative to this page.
    slots = (await loadInventory()).map((entry) =>
      entry.ad && !entry.ad.live
        ? {
            ...entry,
            ad: {
              image_url: "",
              ad_name: "Reserved",
              destination_url: "",
              ends_at: null,
              source: entry.ad.source,
              live: false,
            },
          }
        : entry,
    );
  } catch {
    loadError = "Checkout is temporarily unavailable. Please try again in a few minutes.";
  }

  return (
    <>
      {/*
        The artwork is the largest thing on this page, so its request starts
        first: the browser fetches it while the wizard's JavaScript is still
        arriving, instead of after the panel mounts. One fixed URL on purpose -
        a srcset here would have to be resolved before the fetch can begin.
      */}
      <link
        rel="preload"
        as="image"
        href={PAYMENT_PANEL_ARTWORK_PATH}
        fetchPriority="high"
        referrerPolicy="no-referrer"
      />
      <CheckoutForm
        slots={slots}
        initialSlot={Number.isInteger(requestedSlot) ? requestedSlot : 0}
        loadError={loadError}
      />
    </>
  );
}
