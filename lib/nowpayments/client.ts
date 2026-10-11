/**
 * NOWPayments API client — server-only.
 *
 * Implemented against NOWPayments' official documentation:
 *  - Payment API: https://nowpayments.io/api
 *  - IPN (Instant Payment Notifications): https://nowpayments.io/help/what-is/what-is-ipn
 *
 * Integration notes (from the official references):
 *  - Server-to-server calls authenticate with the `x-api-key` header.
 *  - `POST /v1/payment` creates a payment. The payer sends crypto to the
 *    returned `pay_address`; the payment starts in the `waiting` status.
 *  - NOWPayments POSTs a JSON IPN to `ipn_callback_url` whenever the payment
 *    status changes. Each IPN carries an `x-nowpayments-sig` header holding
 *    the HMAC-SHA512 (hex) of the canonical (key-sorted) JSON body, keyed
 *    with the account's IPN Secret.
 *  - Documented statuses: `waiting`, `confirming`, `confirmed`, `sending`,
 *    `partially_paid`, `finished`, `failed`, `refunded`, `expired`.
 *    Only `finished` means the payment completed — `confirmed` is an
 *    intermediate state (funds confirmed on-chain, still being processed)
 *    and must never trigger fulfillment on its own.
 *
 * Keep NOWPAYMENTS_API_KEY and NOWPAYMENTS_IPN_SECRET server-side only.
 */

import { createHmac, timingSafeEqual } from "crypto";

export const NOWPAYMENTS_API_BASE = "https://api.nowpayments.io/v1";

/** Path this application serves for NOWPayments IPN callbacks. */
export const NOWPAYMENTS_IPN_PATH = "/api/nowpayments/ipn";

/* ------------------------------------------------------------------ */
/* IPN callback URL helpers                                            */
/* ------------------------------------------------------------------ */

/** True when the value looks like the absolute IPN URL this app serves. */
export function isValidNowpaymentsIpnUrl(value: string | null | undefined): value is string {
  const raw = String(value || "").trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    return parsed.pathname.replace(/\/+$/, "").toLowerCase() === NOWPAYMENTS_IPN_PATH;
  } catch {
    return false;
  }
}

/**
 * The IPN callback URL sent to NOWPayments with every payment.
 *
 * Resolution order:
 *  1. `NOWPAYMENTS_IPN_CALLBACK_URL` when it is an absolute URL for
 *     `/api/nowpayments/ipn`.
 *  2. `<siteUrl>/api/nowpayments/ipn` (trailing slashes trimmed).
 */
export function nowpaymentsIpnUrl(siteUrl: string, override?: string | null): string {
  const configured = override === undefined ? process.env.NOWPAYMENTS_IPN_CALLBACK_URL : override;
  const candidate = String(configured || "").trim();
  if (candidate && isValidNowpaymentsIpnUrl(candidate)) {
    const parsed = new URL(candidate);
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`;
  }

  const origin = String(siteUrl || "").trim().replace(/\/+$/, "");
  return `${origin}${NOWPAYMENTS_IPN_PATH}`;
}

/** Where the IPN callback URL comes from — surfaced by admin diagnostics. */
export function nowpaymentsIpnUrlSource(): "NOWPAYMENTS_IPN_CALLBACK_URL" | "NEXT_PUBLIC_SITE_URL" {
  return isValidNowpaymentsIpnUrl(process.env.NOWPAYMENTS_IPN_CALLBACK_URL)
    ? "NOWPAYMENTS_IPN_CALLBACK_URL"
    : "NEXT_PUBLIC_SITE_URL";
}

/* ------------------------------------------------------------------ */
/* Currency / network mapping                                          */
/* ------------------------------------------------------------------ */

/**
 * Explicit mapping from the checkout's (asset, network) choice to the exact
 * NOWPayments `pay_currency` identifier.
 *
 * NOWPayments identifies tokens per network (`usdterc20`, `usdttrc20`,
 * `usdtbsc`, `usdtsol`, …) — these identifiers must never be guessed or
 * silently substituted. Only the combinations listed here can be paid for,
 * and the operator must have the matching coins enabled in the NOWPayments
 * dashboard (Store Settings → Coins) or payment creation fails with a clear
 * provider error.
 */
export const NOWPAYMENTS_CURRENCY_MAP: Record<string, { payCurrency: string; asset: string; network: string }> = {
  "USDT:ethereum": { payCurrency: "usdterc20", asset: "USDT", network: "Ethereum" },
  "USDT:tron": { payCurrency: "usdttrc20", asset: "USDT", network: "Tron" },
  "USDT:binance": { payCurrency: "usdtbsc", asset: "USDT", network: "BNB Smart Chain" },
  "USDT:solana": { payCurrency: "usdtsol", asset: "USDT", network: "Solana" },
  "BTC:bitcoin": { payCurrency: "btc", asset: "BTC", network: "Bitcoin" },
  "ETH:ethereum": { payCurrency: "eth", asset: "ETH", network: "Ethereum" },
  "TRX:tron": { payCurrency: "trx", asset: "TRX", network: "Tron" },
  "BNB:binance": { payCurrency: "bnbbsc", asset: "BNB", network: "BNB Smart Chain" },
  "SOL:solana": { payCurrency: "sol", asset: "SOL", network: "Solana" },
};

export type NowpaymentsCheckoutChoice = {
  /** Asset ticker as shown in checkout (e.g. `USDT`). */
  asset: string;
  /** Network key as stored on the payment (`ethereum`, `tron`, …). */
  chain: string;
  /** Exact NOWPayments `pay_currency` identifier. */
  payCurrency: string;
  /** Human network label shown to the advertiser. */
  network: string;
};

/** Every asset/network combination the checkout may offer. */
export function nowpaymentsCheckoutChoices(): NowpaymentsCheckoutChoice[] {
  return Object.entries(NOWPAYMENTS_CURRENCY_MAP).map(([key, value]) => {
    const [asset, chain] = key.split(":");
    return { asset, chain, payCurrency: value.payCurrency, network: value.network };
  });
}

/** All supported provider currency identifiers. */
export function nowpaymentsSupportedPayCurrencies(): string[] {
  return Object.values(NOWPAYMENTS_CURRENCY_MAP).map((entry) => entry.payCurrency);
}

/**
 * Resolves a checkout (asset, network) selection to the exact NOWPayments
 * `pay_currency`. Returns an error instead of substituting another asset or
 * network when the combination is not explicitly supported.
 */
export function resolvePayCurrency(
  paymentCurrency: string,
  chain: string
): { ok: true; choice: NowpaymentsCheckoutChoice } | { ok: false; error: string } {
  const asset = String(paymentCurrency || "").trim().toUpperCase();
  const network = String(chain || "").trim().toLowerCase();
  const entry = NOWPAYMENTS_CURRENCY_MAP[`${asset}:${network}`];
  if (!entry) {
    return {
      ok: false,
      error:
        `Unsupported asset/network combination: ${asset || "?"} on ${network || "?"}. ` +
        `Supported options are ${nowpaymentsCheckoutChoices()
          .map((choice) => `${choice.asset} on ${choice.network}`)
          .join(", ")}.`,
    };
  }
  return { ok: true, choice: { asset, chain: network, payCurrency: entry.payCurrency, network: entry.network } };
}

/** Reverse lookup: provider identifier → checkout choice (for display). */
export function payCurrencyChoice(payCurrency: string): NowpaymentsCheckoutChoice | null {
  const normalized = String(payCurrency || "").trim().toLowerCase();
  const found = nowpaymentsCheckoutChoices().find((choice) => choice.payCurrency === normalized);
  return found || null;
}

/* ------------------------------------------------------------------ */
/* Status mapping                                                      */
/* ------------------------------------------------------------------ */

export type NowpaymentsProviderStatus =
  | "waiting"
  | "confirming"
  | "confirmed"
  | "sending"
  | "partially_paid"
  | "finished"
  | "failed"
  | "refunded"
  | "expired";

/**
 * NOWPayments status → internal `payments.status`.
 *
 * Critical: `confirmed` is an INTERMEDIATE provider state (transaction
 * confirmed on-chain, NOWPayments still processing). Only `finished` may
 * ever mark a payment paid. `partially_paid` maps to `underpaid` and waits
 * for manual review — campaigns never activate on partial payments.
 */
export const NOWPAYMENTS_STATUS_MAP: Record<NowpaymentsProviderStatus, string> = {
  waiting: "awaiting_confirmation",
  confirming: "partially_confirmed",
  confirmed: "partially_confirmed",
  sending: "partially_confirmed",
  partially_paid: "underpaid",
  finished: "confirmed",
  failed: "failed",
  refunded: "refunded",
  expired: "expired",
};

/**
 * Provider states processed as terminal: they are corroborated against the
 * API and applied with their side effects. `partially_paid` is included —
 * the payment waits for manual review and is never fulfilled, but a later
 * top-up may still complete it via a subsequent `finished` IPN.
 */
const TERMINAL_PROVIDER_STATUSES: ReadonlySet<string> = new Set([
  "finished",
  "failed",
  "refunded",
  "expired",
  "partially_paid",
]);

/** Maps a provider status to the internal status, or null when unknown. */
export function mapNowpaymentsStatus(providerStatus: string | null | undefined): string | null {
  const normalized = String(providerStatus || "").trim().toLowerCase();
  return (NOWPAYMENTS_STATUS_MAP as Record<string, string>)[normalized] ?? null;
}

/** True only for `finished` — the single status that may trigger fulfillment. */
export function isSuccessfulNowpaymentsStatus(providerStatus: string | null | undefined): boolean {
  return String(providerStatus || "").trim().toLowerCase() === "finished";
}

/** True for statuses after which no further automatic transition is expected. */
export function isTerminalNowpaymentsStatus(providerStatus: string | null | undefined): boolean {
  return TERMINAL_PROVIDER_STATUSES.has(String(providerStatus || "").trim().toLowerCase());
}

/* ------------------------------------------------------------------ */
/* Decimal-safe amount comparison                                      */
/* ------------------------------------------------------------------ */

function parseDecimalToUnits(value: string | number | null | undefined, scale = 18): bigint | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw || !/^-?\d+(\.\d+)?$/.test(raw)) return null;
  const negative = raw.startsWith("-");
  const digits = negative ? raw.slice(1) : raw;
  const [whole, fraction = ""] = digits.split(".");
  if (fraction.length > scale) {
    // Truncate (never round up) beyond the working scale.
    const truncated = `${whole}.${fraction.slice(0, scale)}`;
    return parseDecimalToUnits(negative ? `-${truncated}` : truncated, scale);
  }
  const units = BigInt(whole || "0") * 10n ** BigInt(scale) + BigInt((fraction + "0".repeat(scale)).slice(0, scale) || "0");
  return negative ? -units : units;
}

export type NowpaymentsAmountVerdict = "match" | "underpaid" | "overpaid" | "unknown";

/**
 * Compares a received crypto amount with the expected amount using integer
 * math — floating point is never used for financial comparisons.
 *
 * @param toleranceBps accepted deviation in basis points (200 = 2%).
 */
export function compareCryptoAmounts(
  received: string | number | null | undefined,
  expected: string | number | null | undefined,
  toleranceBps = 200
): NowpaymentsAmountVerdict {
  const receivedUnits = parseDecimalToUnits(received);
  const expectedUnits = parseDecimalToUnits(expected);
  if (receivedUnits === null || expectedUnits === null || expectedUnits <= 0n) return "unknown";

  const difference = receivedUnits >= expectedUnits ? receivedUnits - expectedUnits : expectedUnits - receivedUnits;
  if (difference * 10000n <= expectedUnits * BigInt(Math.max(0, toleranceBps))) return "match";
  return receivedUnits < expectedUnits ? "underpaid" : "overpaid";
}

/* ------------------------------------------------------------------ */
/* API client                                                          */
/* ------------------------------------------------------------------ */

export class NowpaymentsApiError extends Error {
  status: number;
  /** True when the failure looks transient and the call may be retried. */
  retryable: boolean;

  constructor(message: string, status = 0, retryable = false) {
    super(message);
    this.name = "NowpaymentsApiError";
    this.status = status;
    this.retryable = retryable;
  }
}

export interface NowpaymentsPayment {
  paymentId: string;
  providerStatus: string;
  payAddress: string | null;
  payAmount: string | null;
  actuallyPaid: string | null;
  payCurrency: string | null;
  priceAmount: string | null;
  priceCurrency: string | null;
  orderId: string | null;
  orderDescription: string | null;
  purchaseId: string | null;
  network: string | null;
  /** Full provider payload for the audit trail (contains no secrets). */
  raw: Record<string, unknown>;
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** Normalizes a `POST /v1/payment` / `GET /v1/payment/{id}` / IPN payload. */
export function normalizeNowpaymentsPayload(payload: unknown): NowpaymentsPayment | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const data = payload as Record<string, unknown>;
  const paymentId = asText(data.payment_id);
  if (!paymentId) return null;
  return {
    paymentId,
    providerStatus: asText(data.payment_status) || "",
    payAddress: asText(data.pay_address),
    payAmount: asText(data.pay_amount),
    actuallyPaid: asText(data.actually_paid),
    payCurrency: asText(data.pay_currency),
    priceAmount: asText(data.price_amount),
    priceCurrency: asText(data.price_currency),
    orderId: asText(data.order_id),
    orderDescription: asText(data.order_description),
    purchaseId: asText(data.purchase_id),
    network: asText(data.network),
    raw: data,
  };
}

async function nowpaymentsFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const apiKey = process.env.NOWPAYMENTS_API_KEY;
  if (!apiKey) throw new NowpaymentsApiError("Missing NOWPAYMENTS_API_KEY", 0, false);

  let res: Response;
  try {
    res = await fetch(`${NOWPAYMENTS_API_BASE}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        ...(init.headers || {}),
      },
      cache: "no-store",
    });
  } catch {
    throw new NowpaymentsApiError("NOWPayments API request failed (network)", 0, true);
  }

  const rawText = await res.text();
  let json: unknown = null;
  try {
    json = rawText ? JSON.parse(rawText) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const providerMessage =
      json && typeof json === "object" && typeof (json as Record<string, unknown>).message === "string"
        ? String((json as Record<string, unknown>).message)
        : "";
    const message = providerMessage
      ? `NOWPayments API error ${res.status}: ${providerMessage}`.slice(0, 300)
      : `NOWPayments API error ${res.status}`;
    const retryable = res.status === 429 || res.status >= 500;
    throw new NowpaymentsApiError(message, res.status, retryable);
  }

  return json;
}

export interface NowpaymentsCreateParams {
  /** Fiat amount as a decimal string, e.g. `"99.00"`. */
  priceAmount: string;
  /** Fiat pricing currency, e.g. `"usd"`. */
  priceCurrency: string;
  /** Provider asset identifier from {@link resolvePayCurrency}. */
  payCurrency: string;
  /** Internal correlation id — the invoice number. Never PII. */
  orderId: string;
  /** Short human description without personal data. */
  orderDescription: string;
  /** Absolute IPN callback URL. */
  ipnCallbackUrl: string;
}

function assertNonEmptyString(value: unknown, field: string, maxLength: number): string {
  const text = String(value ?? "").trim();
  if (!text) throw new NowpaymentsApiError(`NOWPayments ${field} is required`, 0, false);
  if (text.length > maxLength) throw new NowpaymentsApiError(`NOWPayments ${field} is too long`, 0, false);
  return text;
}

/**
 * `POST /v1/payment` — creates a NOWPayments payment and returns the payer
 * instructions. A returned payment id/address is NOT a successful payment;
 * fulfillment happens only on a verified `finished` status.
 */
export async function createNowpaymentsPayment(params: NowpaymentsCreateParams): Promise<NowpaymentsPayment> {
  const priceAmount = assertNonEmptyString(params.priceAmount, "price_amount", 32);
  if (parseDecimalToUnits(priceAmount) === null || parseDecimalToUnits(priceAmount)! <= 0n) {
    throw new NowpaymentsApiError("NOWPayments price_amount must be a positive decimal", 0, false);
  }
  const body = {
    price_amount: Number(priceAmount),
    price_currency: assertNonEmptyString(params.priceCurrency, "price_currency", 16).toLowerCase(),
    pay_currency: assertNonEmptyString(params.payCurrency, "pay_currency", 32).toLowerCase(),
    order_id: assertNonEmptyString(params.orderId, "order_id", 200),
    order_description: assertNonEmptyString(params.orderDescription, "order_description", 255),
    ipn_callback_url: assertNonEmptyString(params.ipnCallbackUrl, "ipn_callback_url", 500),
  };
  if (!isValidNowpaymentsIpnUrl(body.ipn_callback_url)) {
    throw new NowpaymentsApiError("NOWPayments ipn_callback_url must be this app's IPN endpoint", 0, false);
  }
  if (!nowpaymentsSupportedPayCurrencies().includes(body.pay_currency)) {
    throw new NowpaymentsApiError(`NOWPayments pay_currency is not supported: ${body.pay_currency}`, 0, false);
  }

  const json = await nowpaymentsFetch("/payment", { method: "POST", body: JSON.stringify(body) });
  const payment = normalizeNowpaymentsPayload(json);
  if (!payment || !payment.payAddress || !payment.payAmount) {
    throw new NowpaymentsApiError("NOWPayments returned an invalid payment response", 0, false);
  }
  return payment;
}

export type NowpaymentsPaymentLookup =
  | { ok: true; payment: NowpaymentsPayment }
  | { ok: false; reason: "not_found"; status: number }
  | { ok: false; reason: "api_error"; status: number; message: string; retryable: boolean };

/**
 * `GET /v1/payment/{payment_id}` — the authoritative server-side payment
 * record. Used to corroborate IPNs and to refresh pending payments.
 */
export async function getNowpaymentsPayment(paymentId: string): Promise<NowpaymentsPaymentLookup> {
  const id = String(paymentId || "").trim();
  if (!id) return { ok: false, reason: "not_found", status: 400 };
  try {
    const json = await nowpaymentsFetch(`/payment/${encodeURIComponent(id)}`, { method: "GET" });
    const payment = normalizeNowpaymentsPayload(json);
    if (!payment) return { ok: false, reason: "not_found", status: 200 };
    return { ok: true, payment };
  } catch (error: unknown) {
    if (error instanceof NowpaymentsApiError) {
      if (error.status === 404) return { ok: false, reason: "not_found", status: 404 };
      return { ok: false, reason: "api_error", status: error.status, message: error.message, retryable: error.retryable };
    }
    return { ok: false, reason: "api_error", status: 0, message: "NOWPayments lookup failed", retryable: true };
  }
}

/**
 * Safe authenticated connectivity check (`GET /v1/status`). Creates nothing
 * — suitable for admin health screens.
 */
export async function checkNowpaymentsApi(): Promise<{ ok: boolean; status: number; message: string }> {
  if (!process.env.NOWPAYMENTS_API_KEY) {
    return { ok: false, status: 0, message: "Missing NOWPAYMENTS_API_KEY" };
  }
  try {
    await nowpaymentsFetch("/status", { method: "GET" });
    return { ok: true, status: 200, message: "OK" };
  } catch (error: unknown) {
    if (error instanceof NowpaymentsApiError) {
      return { ok: false, status: error.status, message: error.message };
    }
    return { ok: false, status: 0, message: "NOWPayments status check failed" };
  }
}

/**
 * `GET /v1/currencies` — identifiers the NOWPayments platform currently
 * supports. Used by diagnostics to flag allowlist drift; payment creation
 * itself relies on the explicit server allowlist plus the provider's own
 * validation.
 */
export async function getNowpaymentsCurrencies(): Promise<{ ok: true; currencies: string[] } | { ok: false; message: string }> {
  try {
    const json = await nowpaymentsFetch("/currencies", { method: "GET" });
    const list = (json as Record<string, unknown> | null)?.currencies;
    if (!Array.isArray(list)) return { ok: false, message: "Unexpected currencies response" };
    return { ok: true, currencies: list.filter((entry): entry is string => typeof entry === "string") };
  } catch (error: unknown) {
    return { ok: false, message: error instanceof Error ? error.message : "Currency list unavailable" };
  }
}

/* ------------------------------------------------------------------ */
/* IPN signature verification                                          */
/* ------------------------------------------------------------------ */

/**
 * Canonical JSON form for signature computation: top-level keys sorted
 * ascending, then `JSON.stringify` — per NOWPayments' IPN documentation.
 */
export function canonicalIpnJson(payload: unknown): string {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(payload as Record<string, unknown>).sort()) {
      sorted[key] = (payload as Record<string, unknown>)[key];
    }
    return JSON.stringify(sorted);
  }
  return JSON.stringify(payload);
}

/** Computes the expected `x-nowpayments-sig` value for a parsed IPN body. */
export function computeNowpaymentsSignature(payload: unknown, secret: string): string {
  return createHmac("sha512", secret).update(canonicalIpnJson(payload), "utf8").digest("hex");
}

/**
 * Verifies an IPN against the `x-nowpayments-sig` header using
 * `NOWPAYMENTS_IPN_SECRET`. The signature is compared in constant time after
 * validating its shape; any failure means the notification is untrusted.
 */
export function verifyNowpaymentsSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret?: string | null
): { ok: true; payload: unknown } | { ok: false; error: string } {
  const key = secret === undefined ? process.env.NOWPAYMENTS_IPN_SECRET : secret;
  if (!key) return { ok: false, error: "IPN secret is not configured" };

  const signature = String(signatureHeader || "").trim().toLowerCase();
  if (!signature) return { ok: false, error: "Missing IPN signature" };
  if (!/^[0-9a-f]{128}$/.test(signature)) return { ok: false, error: "Malformed IPN signature" };

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { ok: false, error: "Malformed IPN body" };
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "Malformed IPN body" };
  }

  const expected = computeNowpaymentsSignature(payload, key);
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, error: "Invalid IPN signature" };
  }
  return { ok: true, payload };
}

/* ------------------------------------------------------------------ */
/* Diagnostics                                                         */
/* ------------------------------------------------------------------ */

/** Bounded, credential-free error text for server logs. */
export function safeErrorMessage(error: unknown): string {
  const raw =
    typeof (error as { message?: unknown } | null)?.message === "string"
      ? String((error as { message: string }).message)
      : String((error as { name?: unknown } | null)?.name || "unknown error");
  return raw
    .replace(/\/\/[^@\s/]+@/g, "//<redacted>@")
    .replace(/((?:api[_-]?key|apikey|secret|token|password|pwd|bearer)\s*[:=]\s*)[^\s,;)]+/gi, "$1<redacted>")
    .replace(/[?&](secret|key|token|apikey)=[^\s&]+/gi, "$1=<redacted>")
    .slice(0, 300);
}

export interface NowpaymentsSetupReport {
  apiKeyConfigured: boolean;
  apiReachable: boolean;
  apiStatus: number;
  apiMessage: string;
  ipnSecretConfigured: boolean;
  ipnUrl: string;
  ipnUrlSource: "NOWPAYMENTS_IPN_CALLBACK_URL" | "NEXT_PUBLIC_SITE_URL";
  defaultPayCurrency: string;
  defaultPayCurrencyValid: boolean;
  supportedPayCurrencies: string[];
  unavailableCurrencies: string[];
  currenciesChecked: boolean;
  correctiveActions: string[];
  configWarnings: string[];
  error?: string;
}

/**
 * Compares this deployment's NOWPayments configuration against the live API
 * so admins can see exactly what is missing. Never creates a payment.
 */
export async function inspectNowpaymentsSetup(siteUrl: string): Promise<NowpaymentsSetupReport> {
  const override = String(process.env.NOWPAYMENTS_IPN_CALLBACK_URL || "").trim();
  const ipnUrl = nowpaymentsIpnUrl(siteUrl);
  const defaultPayCurrency = String(process.env.NOWPAYMENTS_DEFAULT_PAY_CURRENCY || "usdterc20").trim().toLowerCase();

  const configWarnings: string[] = [];
  if (!isValidNowpaymentsIpnUrl(ipnUrl)) {
    configWarnings.push(
      "The IPN callback URL could not be derived from NEXT_PUBLIC_SITE_URL. Set NEXT_PUBLIC_SITE_URL (e.g. https://erobabe.vercel.app) in the hosting environment."
    );
  }
  if (override && !isValidNowpaymentsIpnUrl(override)) {
    configWarnings.push(
      `NOWPAYMENTS_IPN_CALLBACK_URL is set but is not an absolute URL for ${NOWPAYMENTS_IPN_PATH}; it is ignored. Fix it or remove it.`
    );
  }

  const report: NowpaymentsSetupReport = {
    apiKeyConfigured: Boolean(process.env.NOWPAYMENTS_API_KEY),
    apiReachable: false,
    apiStatus: 0,
    apiMessage: "",
    ipnSecretConfigured: Boolean(process.env.NOWPAYMENTS_IPN_SECRET),
    ipnUrl,
    ipnUrlSource: nowpaymentsIpnUrlSource(),
    defaultPayCurrency,
    defaultPayCurrencyValid: nowpaymentsSupportedPayCurrencies().includes(defaultPayCurrency),
    supportedPayCurrencies: nowpaymentsSupportedPayCurrencies(),
    unavailableCurrencies: [],
    currenciesChecked: false,
    correctiveActions: [],
    configWarnings,
  };

  if (!report.defaultPayCurrencyValid) {
    report.configWarnings.push(
      `NOWPAYMENTS_DEFAULT_PAY_CURRENCY ("${defaultPayCurrency || "empty"}") is not one of the supported pay currencies (${report.supportedPayCurrencies.join(", ")}). Checkout falls back to usdterc20.`
    );
  }
  if (!report.ipnSecretConfigured) {
    report.correctiveActions.push(
      "Set NOWPAYMENTS_IPN_SECRET in the hosting environment to the IPN Secret Key from the NOWPayments dashboard (Store Settings → IPN Secret Key / Generate). Without it every incoming IPN is rejected."
    );
  }

  if (!report.apiKeyConfigured) {
    report.error = "NOWPAYMENTS_API_KEY is not set";
    report.apiMessage = report.error;
    report.correctiveActions.push(
      "Set NOWPAYMENTS_API_KEY in the hosting environment (Vercel → Settings → Environment Variables) to the API key from the NOWPayments dashboard."
    );
    return report;
  }

  const status = await checkNowpaymentsApi();
  report.apiReachable = status.ok;
  report.apiStatus = status.status;
  report.apiMessage = status.message;
  if (!status.ok) {
    report.error = status.message;
    report.correctiveActions.push(
      "Check that NOWPAYMENTS_API_KEY is valid and that the NOWPayments API is reachable from this deployment, then re-check."
    );
    return report;
  }

  const currencies = await getNowpaymentsCurrencies();
  if (currencies.ok) {
    report.currenciesChecked = true;
    const available = new Set(currencies.currencies.map((entry) => entry.toLowerCase()));
    report.unavailableCurrencies = report.supportedPayCurrencies.filter((entry) => !available.has(entry));
    if (report.unavailableCurrencies.length) {
      report.configWarnings.push(
        `NOWPayments does not currently list these configured pay currencies: ${report.unavailableCurrencies.join(", ")}. ` +
          "Payment creation for them will fail until the identifiers are corrected or the coins are re-enabled."
      );
    }
  }

  if (!report.correctiveActions.length && !report.configWarnings.length) {
    report.correctiveActions.push(
      "NOWPayments is configured and reachable. Create a minimum-amount test payment and confirm the IPN completes it before accepting real payments."
    );
  }
  return report;
}

/**
 * Reachability probe of our own IPN endpoint (parameter-less GET). Proves the
 * URL answers — it does NOT prove NOWPayments has it configured.
 */
export async function probeNowpaymentsIpnEndpoint(siteUrl: string): Promise<{
  ok: boolean;
  url: string;
  status: number;
  body: string;
  error?: string;
}> {
  const url = nowpaymentsIpnUrl(siteUrl);
  if (!isValidNowpaymentsIpnUrl(url)) {
    return { ok: false, url, status: 0, body: "", error: `The IPN URL is not an absolute URL for ${NOWPAYMENTS_IPN_PATH}` };
  }
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
    const body = (await res.text()).slice(0, 200);
    return { ok: res.status === 200, url, status: res.status, body };
  } catch (error: unknown) {
    return { ok: false, url, status: 0, body: "", error: safeErrorMessage(error) || "IPN endpoint could not be reached" };
  }
}
