/**
 * Advertising checkout payment constants.
 *
 * The guest checkout no longer shows a QR code of its own: the right-hand
 * panel shows the advertising artwork, served as a static 8:9 asset from our
 * own origin, and step 3 hands the visitor to the hosted payment page. That page
 * redirects back to the public homepage after a successful payment, where a
 * short confirmation card is displayed once.
 */

/** Hosted PayPal payment page for one 1-month 16:9 advertising placement. */
export const PAYPAL_PAYMENT_URL = "https://www.paypal.com/ncp/payment/AZP63KXT9FUNL";

/**
 * The artwork in the fixed checkout panel, drawn at 8:9 to match the file.
 *
 * It is committed to the repo rather than fetched from an image host: the
 * panel used to wait on a multi-megabyte third-party PNG with weak cache
 * headers. Both copies below are 960 × 1080 (exactly 8:9); the WebP is ~4×
 * smaller than the PNG and is what every current browser gets, and the PNG is
 * only the fallback for the ones that are not.
 */
export const PAYMENT_PANEL_ARTWORK_PATH = "/checkout/advertise-panel.webp";
export const PAYMENT_PANEL_ARTWORK_FALLBACK = "/checkout/advertise-panel.png";
/** Source dimensions, so the panel reserves the right box before it loads. */
export const PAYMENT_PANEL_ARTWORK_WIDTH = 960;
export const PAYMENT_PANEL_ARTWORK_HEIGHT = 1080;
/** The panel's shape: 960 × 1080. */
export const PAYMENT_PANEL_ASPECT = "8 / 9";

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
