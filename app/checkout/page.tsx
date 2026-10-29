import type { Metadata } from "next";
import CheckoutForm from "./CheckoutForm";
import { loadInventory, type InventorySlot } from "@/lib/ads/inventory";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Advertise with PayPal — erobabe",
  description: "Choose a 16:9 placement, upload your banner, and pay with PayPal.",
  alternates: { canonical: `${SITE_URL}/checkout` },
  robots: { index: false, follow: false },
};

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
    <CheckoutForm
      slots={slots}
      initialSlot={Number.isInteger(requestedSlot) ? requestedSlot : 0}
      loadError={loadError}
    />
  );
}
