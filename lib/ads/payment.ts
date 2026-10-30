/**
 * Advertising checkout payment constants.
 *
 * The guest checkout no longer shows a QR code of its own: the right-hand
 * panel shows the advertiser's payment artwork, served through our own cached
 * route, and step 3 hands the visitor to the hosted payment page. That page
 * redirects back to the public homepage after a successful payment, where a
 * short confirmation card is displayed once.
 */

/** Hosted PayPal payment page for one 1-month 16:9 advertising placement. */
export const PAYPAL_PAYMENT_URL = "https://www.paypal.com/ncp/payment/AZP63KXT9FUNL";

/** The artwork shown in the fixed checkout panel (advertiser payment artwork). */
export const PAYMENT_PANEL_IMAGE_URL =
  process.env.NEXT_PUBLIC_PAYMENT_PANEL_IMAGE_URL ||
  "https://i.ibb.co/SXhzQ4ZQ/Untitled-Design-18-1.png";

/**
 * Same-origin copy served by `/api/assets/payment-artwork`: it fetches the
 * artwork once, downsizes and re-encodes it, and serves it `immutable` from our
 * own origin, so the panel does not wait on a cold third-party origin for a
 * multi-megabyte PNG. `?w=mobile` asks for the smaller variant.
 */
export const PAYMENT_PANEL_ARTWORK_PATH = "/api/assets/payment-artwork";

/**
 * Last resort: the hosted file itself. Reached only when the cached route cannot
 * produce a copy, so the panel still shows the artwork — just slowly, as it used
 * to. Kept as its own name so the fallback chain in `PaymentPanel` reads plainly.
 */
export const PAYMENT_PANEL_IMAGE_FALLBACK = PAYMENT_PANEL_IMAGE_URL;

/**
 * Local flag written just before the visitor leaves for PayPal. When they come
 * back to the homepage the "In review" card is shown once, then cleared.
 */
export const AD_REVIEW_FLAG_KEY = "erobabe:ad-review";

/** How long the review card stays on screen before returning home. */
export const AD_REVIEW_HOLD_MS = 10_000;

/** A flag older than this is treated as stale and ignored. */
export const AD_REVIEW_MAX_AGE_MS = 30 * 60 * 1000;

/** Every advertising order is sold in whole months; checkout sells one. */
export const CHECKOUT_DURATION_MONTHS = 1;
