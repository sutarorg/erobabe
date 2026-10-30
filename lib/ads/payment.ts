/**
 * Advertising checkout payment constants.
 *
 * The guest checkout no longer shows a QR code of its own: the right-hand
 * panel shows the advertiser's payment artwork and step 3 hands the visitor
 * to the hosted PayPal payment page. PayPal redirects back to the public
 * homepage after a successful payment, where the "In review" confirmation is
 * displayed for ten seconds.
 */

/** Hosted PayPal payment page for one 1-month 16:9 advertising placement. */
export const PAYPAL_PAYMENT_URL = "https://www.paypal.com/ncp/payment/AZP63KXT9FUNL";

/** The artwork shown in the fixed checkout panel (advertiser payment artwork). */
export const PAYMENT_PANEL_IMAGE_URL =
  process.env.NEXT_PUBLIC_PAYMENT_PANEL_IMAGE_URL ||
  "https://i.ibb.co/SXhzQ4ZQ/Untitled-Design-18-1.png";

/** Bundled fallback if the hosted artwork cannot be reached. */
export const PAYMENT_PANEL_IMAGE_FALLBACK = "/paypal-qr.png";

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
