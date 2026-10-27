import type { Metadata } from "next";
import CheckoutForm from "./CheckoutForm";
import { loadInventory } from "@/lib/ads/inventory";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Advertise with PayPal — erobabe",
  description: "Submit a 16:9 advertisement for an erobabe sidebar placement.",
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
  let slots: Awaited<ReturnType<typeof loadInventory>> = [];
  let loadError = "";

  try {
    slots = await loadInventory();
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
