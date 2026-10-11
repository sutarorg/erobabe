/**
 * Bcon Global API client — server-only.
 *
 * Verified against Bcon's published API documentation
 * (https://bcon.global/integrations/api/) on 2026-10-11:
 *
 * - A Bcon store carries ONE callback URL PER BLOCKCHAIN. The store payload
 *   exposes them as flat fields — `callback_url` (BTC) and `callback_url_bnb`
 *   (BNB), plus a `callback_url_<code>` entry for every other configured chain
 *   — and as `chains[]` entries that each carry their own `callback_url`.
 * - `GET /api/v1/stores` and `.../stores/get_store` "by default return
 *   information on BTC and BNB even if they are empty", which is why a store
 *   form that leaves those fields blank comes back with Bcon's own Laravel
 *   validation message `The callback_url.btc must be a string.`
 *   (`callback_url.btc` is the form-validation path of the BTC field; the
 *   message appears when the field is submitted as `null` — i.e. left empty.)
 * - Bcon's public API has NO documented store-update endpoint, so this client
 *   never writes store configuration. Callback URLs are entered by the
 *   operator in the Bcon dashboard and read back for diagnostics.
 * - Callback parameters: `status` (0 = unconfirmed, 1 = partially confirmed,
 *   2 = confirmed), `addr`, `value` (satoshis for BTC), `txid`, `external_id`
 *   (plus `memo` for BNB). A callback "succeeds when the server returns 200".
 * - `GET /api/v1/transactions/<txid>` returns the authoritative server-side
 *   transaction record (`address`, `status`, `sum`, `currency`, `store`).
 *
 * Keep BCON_API_KEY server-side only.
 */

import { randomUUID } from "crypto";

const BCON_API_V1 = "https://external-api.bcon.global/api/v1";
const BCON_API_V2 = "https://external-api.bcon.global/api/v2";

/** Path this application serves for Bcon payment callbacks. */
export const BCON_CALLBACK_PATH = "/api/bcon/callback";

/** Bcon identifies chains by a short code in store config and API keys. */
export const BCON_CHAIN_CODES = {
  bitcoin: "btc",
  binance: "bnb",
  ethereum: "eth",
  tron: "trx",
  solana: "sol",
} as const;

export type BconChain = keyof typeof BCON_CHAIN_CODES;
export type BconChainCode = (typeof BCON_CHAIN_CODES)[BconChain];
export const BCON_CHAINS = Object.keys(BCON_CHAIN_CODES) as BconChain[];

export function bconChainCode(chain: string): string {
  const normalized = String(chain || "").trim().toLowerCase();
  return (BCON_CHAIN_CODES as Record<string, string>)[normalized] || normalized;
}

/**
 * Store payload / dashboard field names per chain.
 *
 * `apiField` follows Bcon's documented flat naming (`callback_url` for BTC,
 * `callback_url_bnb` for BNB, `callback_url_<code>` for the rest).
 * `validationPath` is the path Bcon's own form validation reports — the one
 * that appears in `The callback_url.btc must be a string.`
 */
export const BCON_CALLBACK_FIELDS: Record<
  BconChainCode,
  { chain: BconChain; apiField: string; validationPath: string; dashboardLabel: string }
> = {
  btc: { chain: "bitcoin", apiField: "callback_url", validationPath: "callback_url.btc", dashboardLabel: "BTC callback URL" },
  bnb: { chain: "binance", apiField: "callback_url_bnb", validationPath: "callback_url.bnb", dashboardLabel: "BNB callback URL" },
  eth: { chain: "ethereum", apiField: "callback_url_eth", validationPath: "callback_url.eth", dashboardLabel: "ETH callback URL" },
  trx: { chain: "tron", apiField: "callback_url_trx", validationPath: "callback_url.trx", dashboardLabel: "TRX callback URL" },
  sol: { chain: "solana", apiField: "callback_url_sol", validationPath: "callback_url.sol", dashboardLabel: "SOL callback URL" },
};

/** True when the value looks like the absolute callback URL this app serves. */
export function isValidBconCallbackUrl(value: string | null | undefined): value is string {
  const raw = String(value || "").trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    return parsed.pathname.replace(/\/+$/, "").toLowerCase() === BCON_CALLBACK_PATH;
  } catch {
    return false;
  }
}

/**
 * The single callback URL every chain on the Bcon store must be pointed at.
 *
 * Resolution order:
 *  1. `BCON_CALLBACK_URL` when it is an absolute URL for `/api/bcon/callback`.
 *  2. `<siteUrl>/api/bcon/callback` (trailing slashes trimmed).
 *
 * Always returns a plain, non-empty string — never null, an array, or an
 * object. The value is what the operator pastes into each Bcon chain field.
 */
export function bconCallbackUrl(siteUrl: string, override?: string | null): string {
  const configured = override === undefined ? process.env.BCON_CALLBACK_URL : override;
  const candidate = String(configured || "").trim();
  if (candidate && isValidBconCallbackUrl(candidate)) {
    const parsed = new URL(candidate);
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`;
  }

  const origin = String(siteUrl || "").trim().replace(/\/+$/, "");
  return `${origin}${BCON_CALLBACK_PATH}`;
}

/** Where the callback URL comes from — surfaced by the admin diagnostics. */
export function bconCallbackUrlSource(): "BCON_CALLBACK_URL" | "NEXT_PUBLIC_SITE_URL" {
  return isValidBconCallbackUrl(process.env.BCON_CALLBACK_URL) ? "BCON_CALLBACK_URL" : "NEXT_PUBLIC_SITE_URL";
}

/** Chain code -> the plain URL string to enter in that chain's dashboard field. */
export type BconCallbackUrlMap = Record<BconChainCode, string>;

export function bconCallbackUrlMap(siteUrl: string): BconCallbackUrlMap {
  const url = bconCallbackUrl(siteUrl);
  const map: BconCallbackUrlMap = { btc: url, bnb: url, eth: url, trx: url, sol: url };
  for (const [code, value] of Object.entries(map)) {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`callback_url.${code} must be a non-empty string`);
    }
  }
  return map;
}

export interface BconCallbackField {
  code: BconChainCode;
  chain: BconChain;
  /** Flat store field name documented by Bcon (`callback_url`, `callback_url_bnb`, …). */
  apiField: string;
  /** Path Bcon's form validation reports (`callback_url.btc`, …). */
  validationPath: string;
  /** Human label of the dashboard input. */
  dashboardLabel: string;
  /** The raw URL string that belongs in that field. */
  value: string;
}

/** One entry per supported chain: exactly what to type into each dashboard field. */
export function bconCallbackFields(siteUrl: string): BconCallbackField[] {
  const url = bconCallbackUrl(siteUrl);
  if (typeof url !== "string" || !url.startsWith("http")) {
    throw new Error("callback_url.btc must be a string");
  }
  return (Object.keys(BCON_CALLBACK_FIELDS) as BconChainCode[]).map((code) => ({
    code,
    chain: BCON_CALLBACK_FIELDS[code].chain,
    apiField: BCON_CALLBACK_FIELDS[code].apiField,
    validationPath: BCON_CALLBACK_FIELDS[code].validationPath,
    dashboardLabel: BCON_CALLBACK_FIELDS[code].dashboardLabel,
    value: url,
  }));
}

export interface BconCreateAddressParams {
  payment_currency: string; // USDT, USDC, BTC...
  origin_amount: string; // e.g. "99"
  origin_currency: string; // USD
  external_id: string; // Bcon returns this to us in its callback (max 8 chars)
  chain: string; // ethereum | tron | binance | bitcoin | solana
  payment_amount?: string;
}

/**
 * Request body for `POST /api/v2/address`.
 *
 * Bcon expects every field as a string (the documented example sends
 * `"origin_amount": "15"`), so this builder guarantees string types and the
 * documented eight-character `external_id` limit instead of relying on the
 * call site.
 */
export function bconCreateAddressPayload(params: BconCreateAddressParams): Record<string, string> {
  const externalId = String(params.external_id ?? "").trim();
  if (!externalId) throw new Error("external_id is required by the Bcon address API");
  if (externalId.length > 8) throw new Error("Bcon external_id must be at most 8 characters");

  const payload: Record<string, string> = {
    payment_currency: String(params.payment_currency ?? "").trim(),
    origin_amount: String(params.origin_amount ?? "").trim(),
    origin_currency: String(params.origin_currency ?? "").trim(),
    external_id: externalId,
    chain: String(params.chain ?? "").trim().toLowerCase(),
  };
  if (params.payment_amount !== undefined && params.payment_amount !== null) {
    payload.payment_amount = String(params.payment_amount).trim();
  }

  for (const [key, value] of Object.entries(payload)) {
    if (typeof value !== "string" || !value) throw new Error(`${key} must be a non-empty string`);
  }
  return payload;
}

export interface BconCreateAddressResponse {
  status: string;
  data?: {
    address?: string;
    amount?: string;
    payment_amount?: string;
    currency?: string;
    payment_currency?: string;
    chain?: string;
    external_id?: string;
  };
  [key: string]: unknown;
}

/**
 * Bcon documents an eight-character maximum for external_id. Generate a short
 * opaque reference instead of leaking a user id or invoice number to Bcon.
 */
export function createBconExternalId(): string {
  return `E${randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
}

function getResponseAmount(json: BconCreateAddressResponse, fallback: string): string {
  const amount =
    json.data?.payment_amount ??
    json.data?.amount ??
    (json as Record<string, unknown>).payment_amount ??
    (json as Record<string, unknown>).amount ??
    fallback;

  return String(amount);
}

export async function createBconPaymentAddress(
  params: BconCreateAddressParams
): Promise<{ address: string; amount: string; raw: BconCreateAddressResponse }> {
  const apiKey = process.env.BCON_API_KEY;
  if (!apiKey) throw new Error("Missing BCON_API_KEY");

  const res = await fetch(`${BCON_API_V2}/address`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(bconCreateAddressPayload(params)),
    cache: "no-store",
  });

  const rawText = await res.text();
  let json: BconCreateAddressResponse | null = null;
  try {
    json = JSON.parse(rawText) as BconCreateAddressResponse;
  } catch {
    // Preserve a concise provider diagnostic without exposing request headers.
    if (!res.ok) throw new Error(`Bcon API error ${res.status}`);
    throw new Error("Bcon returned an invalid JSON response");
  }

  if (!res.ok) {
    const message = typeof json.message === "string" ? `: ${json.message}` : "";
    throw new Error(`Bcon API error ${res.status}${message}`);
  }

  // Current docs return data.address and data.payment_amount. Retain the
  // legacy alternatives for compatibility with existing Bcon stores.
  const legacy = json as Record<string, unknown>;
  const legacyResult = legacy.result;
  const resultAddress =
    legacyResult && typeof legacyResult === "object"
      ? (legacyResult as Record<string, unknown>).address
      : undefined;
  const address = json.data?.address || legacy.address || resultAddress;

  if (!address || typeof address !== "string") {
    throw new Error("Bcon did not return a payment address");
  }

  return { address, amount: getResponseAmount(json, params.origin_amount), raw: json };
}

/* ------------------------------------------------------------------ */
/* Callback payloads                                                   */
/* ------------------------------------------------------------------ */

export interface BconCallbackQuery {
  addr?: string;
  address?: string;
  /** Bcon's Test Payment endpoint posts the amount as `sum` (coin units). */
  txid?: string;
  transaction_id?: string;
  value?: string;
  amount?: string;
  sum?: string;
  status?: string;
  external_id?: string;
  currency?: string;
  currency_id?: string;
  chain?: string;
  store_id?: string;
  /** Required field for BNB stores in Bcon's Test Payment API. */
  memo?: string;
  secret?: string;
  // plus any other callback fields
  [key: string]: string | undefined;
}

/**
 * Amount received, whichever field Bcon used. The live callback sends `value`
 * (satoshis for BTC); the Test Payment endpoint uses `sum` (coin units).
 */
export function bconCallbackAmount(callback: BconCallbackQuery): string | undefined {
  if (callback.value) return callback.value;
  if (callback.amount) return callback.amount;
  return callback.sum;
}

/**
 * The callback amount converted to whole-coin units so it can be compared
 * with the amount Bcon's address API returned (`payment_amount`).
 *
 * Bcon's docs state callback balance units are satoshis; that applies to the
 * live `value` parameter. The Test Payment `sum` parameter is already in coin
 * units (the documented example sends `"sum": "0.000005"`).
 */
export function bconCallbackAmountInCoinUnits(
  chain: string,
  callback: BconCallbackQuery
): { amount: number; source: "value" | "amount" | "sum"; unitAdjusted: boolean } | null {
  const source = callback.value ? "value" : callback.amount ? "amount" : callback.sum ? "sum" : null;
  if (!source) return null;
  const parsed = Number(String(callback[source]).trim());
  if (!Number.isFinite(parsed)) return null;
  const unitAdjusted = source === "value" && bconChainCode(chain) === "btc";
  return { amount: unitAdjusted ? parsed / 100_000_000 : parsed, source, unitAdjusted };
}

export type BconAmountVerdict = "match" | "underpaid" | "overpaid" | "unknown";

/** Compares a received crypto amount with the amount Bcon asked the payer to send. */
export function parseBconAmount(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function compareBconAmounts(
  received: string | number | null | undefined,
  expected: string | number | null | undefined,
  tolerance = 0.02
): BconAmountVerdict {
  const receivedValue = parseBconAmount(received);
  const expectedValue = parseBconAmount(expected);
  if (receivedValue === null || expectedValue === null || expectedValue <= 0) return "unknown";

  const difference = Math.abs(receivedValue - expectedValue);
  if (difference <= expectedValue * tolerance) return "match";
  return receivedValue < expectedValue ? "underpaid" : "overpaid";
}

/**
 * Validate callback — Bcon docs example uses query params with addr, txid,
 * value and external_id. Incoming values remain untrusted until verified
 * against our payment records and Bcon's transaction API.
 */
export function parseBconCallback(url: URL): BconCallbackQuery {
  const q: BconCallbackQuery = {};
  url.searchParams.forEach((v, k) => {
    q[k] = v;
  });
  return q;
}

export type BconTxStatus = "unconfirmed" | "partially_confirmed" | "confirmed" | "failed";

/**
 * Bcon documents callback status 2 = confirmed, 1 = partially confirmed and
 * 0 = unconfirmed. Its Test Payment API and transaction API use the same
 * words spelled out.
 */
export function mapBconStatus(rawStatus?: string): BconTxStatus {
  const s = String(rawStatus ?? "").trim().toLowerCase();
  if (!s) return "unconfirmed";
  if (s === "2") return "confirmed";
  if (s === "1") return "partially_confirmed";
  if (s === "0") return "unconfirmed";
  if (s === "confirmed" || s === "ok") return "confirmed";
  if (s.includes("confirm") && s.includes("partial")) return "partially_confirmed";
  if (s === "partially" || s === "partially-confirmed" || s === "partiallyconfirmed") return "partially_confirmed";
  if (s.includes("unconfirm") || s === "pending") return "unconfirmed";
  return "unconfirmed";
}

/* ------------------------------------------------------------------ */
/* Store inspection — used by the admin panel to verify that every     */
/* chain on the Bcon store actually has the callback URL filled in.    */
/* ------------------------------------------------------------------ */

export interface BconChainConfig {
  chain: string;
  code: string;
  callbackUrl: string | null;
  hasApiKey: boolean;
}

export interface BconStore {
  id: number | string;
  name: string | null;
  tag: string | null;
  chains: BconChainConfig[];
}

async function bconGet(path: string): Promise<any> {
  const apiKey = process.env.BCON_API_KEY;
  if (!apiKey) throw new Error("Missing BCON_API_KEY");

  const res = await fetch(`${BCON_API_V1}/${path.replace(/^\/+/, "")}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });

  const rawText = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(rawText);
  } catch {
    throw new Error(`Bcon API error ${res.status}`);
  }
  if (!res.ok) {
    const message = typeof json?.message === "string" ? `: ${json.message}` : "";
    throw new Error(`Bcon API error ${res.status}${message}`);
  }
  return json;
}

function asCallbackUrl(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Reads the flat per-chain callback fields from a store payload
 * (`callback_url`, `callback_url_bnb`, `callback_url_<code>`).
 */
export function bconStoreCallbackFieldValues(entry: any): Record<string, string | null> {
  const values: Record<string, string | null> = {};
  for (const code of Object.keys(BCON_CALLBACK_FIELDS) as BconChainCode[]) {
    values[BCON_CALLBACK_FIELDS[code].apiField] = asCallbackUrl(entry?.[BCON_CALLBACK_FIELDS[code].apiField]);
  }
  return values;
}

/** Normalises one entry of Bcon's `data.addresses[]` store payload. */
export function normalizeBconStore(entry: any): BconStore {
  const flat = bconStoreCallbackFieldValues(entry);
  const chains: BconChainConfig[] = Array.isArray(entry?.chains)
    ? entry.chains.map((chain: any) => {
        const code = String(chain?.code || bconChainCode(chain?.chain || ""));
        const apiField = (BCON_CALLBACK_FIELDS as Record<string, { apiField: string } | undefined>)[code]?.apiField;
        // A chain entry can still be empty while the flat store column is set
        // (BTC/BNB are always returned, even when unused).
        const callbackUrl = asCallbackUrl(chain?.callback_url) ?? (apiField ? flat[apiField] ?? null : null);
        return {
          chain: String(chain?.chain || ""),
          code,
          callbackUrl,
          hasApiKey: Boolean(chain?.api_key),
        };
      })
    : [];

  // Older store payloads expose only the flat columns and no `chains[]`.
  if (!chains.length) {
    for (const code of Object.keys(BCON_CALLBACK_FIELDS) as BconChainCode[]) {
      const field = BCON_CALLBACK_FIELDS[code];
      if (code !== "btc" && code !== "bnb" && !(field.apiField in (entry || {}))) continue;
      chains.push({
        chain: field.chain,
        code,
        callbackUrl: flat[field.apiField] ?? null,
        hasApiKey: Boolean(entry?.[`api_key${code === "btc" ? "" : `_${code}`}`]),
      });
    }
  }

  return { id: entry?.id ?? "", name: entry?.name ?? null, tag: entry?.tag ?? null, chains };
}

/** `GET /api/v1/stores/get_store` — the store that owns BCON_API_KEY. */
export async function getBconStore(): Promise<BconStore | null> {
  const json = await bconGet("stores/get_store");
  const entries = json?.data?.addresses;
  if (!Array.isArray(entries) || !entries.length) return null;
  return normalizeBconStore(entries[0]);
}

/** `GET /api/v1/stores` — every store on the account. */
export async function listBconStores(): Promise<BconStore[]> {
  const json = await bconGet("stores");
  const entries = json?.data?.addresses;
  return Array.isArray(entries) ? entries.map(normalizeBconStore) : [];
}

/* ------------------------------------------------------------------ */
/* Transaction verification (server-side, trusted)                     */
/* ------------------------------------------------------------------ */

export interface BconTransaction {
  transactionId: string;
  address: string | null;
  /** Raw status from Bcon: unconfirmed | partially_confirmed | confirmed. */
  status: string;
  /** Amount in coin units as Bcon reports it. */
  sum: string | null;
  currency: string | null;
  storeId: number | string | null;
  storeName: string | null;
  createdAt: string | null;
}

export type BconTransactionLookup =
  | { ok: true; transaction: BconTransaction }
  | { ok: false; reason: "not_found"; status: number }
  | { ok: false; reason: "api_error"; status: number; message: string };

/**
 * `GET /api/v1/transactions/<txid>` — the authoritative record for a
 * transaction id. Used to confirm that a callback's txid really exists in
 * Bcon, went to our payment address and is confirmed before any payment is
 * marked paid.
 */
export async function getBconTransaction(txid: string): Promise<BconTransactionLookup> {
  const apiKey = process.env.BCON_API_KEY;
  if (!apiKey) return { ok: false, reason: "api_error", status: 0, message: "Missing BCON_API_KEY" };

  const id = String(txid || "").trim();
  if (!id) return { ok: false, reason: "not_found", status: 400 };

  let res: Response;
  try {
    res = await fetch(`${BCON_API_V1}/transactions/${encodeURIComponent(id)}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "api_error", status: 0, message: "Bcon transaction lookup failed (network)" };
  }

  const rawText = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(rawText);
  } catch {
    json = null;
  }

  if (!res.ok) {
    if (res.status === 404) return { ok: false, reason: "not_found", status: res.status };
    return {
      ok: false,
      reason: "api_error",
      status: res.status,
      message: `Bcon transaction lookup failed (${res.status})`,
    };
  }

  const transaction = json?.data?.transaction ?? json?.data ?? null;
  if (!transaction || typeof transaction !== "object" || !transaction.transaction_id) {
    return { ok: false, reason: "not_found", status: res.status };
  }

  return {
    ok: true,
    transaction: {
      transactionId: String(transaction.transaction_id),
      address: asCallbackUrl(transaction.address),
      status: String(transaction.status ?? ""),
      sum: transaction.sum === undefined || transaction.sum === null ? null : String(transaction.sum),
      currency: transaction?.currency?.iso_name ? String(transaction.currency.iso_name) : null,
      storeId: transaction?.store?.id ?? null,
      storeName: transaction?.store?.name ?? null,
      createdAt: transaction.created_at ?? null,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Admin diagnostics                                                   */
/* ------------------------------------------------------------------ */

export interface BconChainCheck {
  chain: string;
  code: string;
  callbackUrl: string | null;
  hasApiKey: boolean;
  /** True when the chain's callback URL is exactly the one this app serves. */
  callbackMatchesSite: boolean;
}

export interface BconCallbackFieldCheck extends BconCallbackField {
  /** Value currently registered on the store, or null when empty. */
  actual: string | null;
  matchesExpected: boolean;
  /** True when the store payload returned this chain at all. */
  reportedByStore: boolean;
}

export interface BconSetupReport {
  configured: boolean;
  callbackUrl: string;
  callbackUrlSource: "BCON_CALLBACK_URL" | "NEXT_PUBLIC_SITE_URL";
  callbackUrlMap: BconCallbackUrlMap;
  /** One row per chain: the field name and the exact URL to paste into it. */
  callbackFields: BconCallbackFieldCheck[];
  expectedChain: string;
  expectedChainCode: string;
  paymentCurrency: string;
  store: BconStore | null;
  chains: BconChainCheck[];
  /** Chains the store reports with an EMPTY callback_url — the fields Bcon's
   *  form rejects with `callback_url.<code> must be a string`. */
  missingCallbackChains: string[];
  /** Chains whose stored callback URL is set but points somewhere else. */
  mismatchedCallbackChains: string[];
  /** Plain-language fixes the operator has to perform in the dashboard. */
  correctiveActions: string[];
  /** Things this diagnostic cannot check with the public Bcon API. */
  unverified: string[];
  configWarnings: string[];
  error?: string;
}

const STATIC_UNVERIFIED_NOTES = [
  "Bcon publishes no store-write endpoint, so this app cannot change the store for you. Callback URLs must be entered in the Bcon dashboard.",
  "The Add/Edit Store form itself is not exposed by the Bcon API — which inputs it renders and whether it has other validation problems cannot be checked from here.",
  "Stored callback values are read back from Bcon, but delivery can only be proven by a real callback (or a genuine payment) reaching /api/bcon/callback.",
];

/**
 * Compares the live Bcon store against this deployment's configuration so the
 * admin can see precisely which per-chain callback fields still need to be
 * filled in on the Bcon dashboard.
 */
export async function inspectBconSetup(siteUrl: string): Promise<BconSetupReport> {
  const override = String(process.env.BCON_CALLBACK_URL || "").trim();
  const overrideValid = Boolean(override) && isValidBconCallbackUrl(override);
  const callbackUrl = bconCallbackUrl(siteUrl);
  const callbackUrlMap = bconCallbackUrlMap(siteUrl);
  const callbackFieldDefinitions = bconCallbackFields(siteUrl);
  const expectedChain = (process.env.BCON_CHAIN || "ethereum").trim().toLowerCase();
  const expectedChainCode = bconChainCode(expectedChain);

  const configWarnings: string[] = [];
  if (!isValidBconCallbackUrl(callbackUrl)) {
    configWarnings.push(
      "The callback URL could not be derived from NEXT_PUBLIC_SITE_URL. Set NEXT_PUBLIC_SITE_URL (e.g. https://erobabe.vercel.app) in the hosting environment."
    );
  }
  if (override && !overrideValid) {
    configWarnings.push(
      `BCON_CALLBACK_URL is set but is not an absolute URL for ${BCON_CALLBACK_PATH}; it is ignored. Fix it or remove it.`
    );
  }

  const report: BconSetupReport = {
    configured: Boolean(process.env.BCON_API_KEY),
    callbackUrl,
    callbackUrlSource: bconCallbackUrlSource(),
    callbackUrlMap,
    callbackFields: callbackFieldDefinitions.map((field) => ({ ...field, actual: null, matchesExpected: false, reportedByStore: false })),
    expectedChain,
    expectedChainCode,
    paymentCurrency: (process.env.BCON_PAYMENT_CURRENCY || "USDT").toUpperCase(),
    store: null,
    chains: [],
    missingCallbackChains: [],
    mismatchedCallbackChains: [],
    correctiveActions: [],
    unverified: [...STATIC_UNVERIFIED_NOTES],
    configWarnings,
  };

  if (!report.configured) {
    report.error = "BCON_API_KEY is not set";
    report.correctiveActions = [
      "Set BCON_API_KEY in the hosting environment (Vercel → Settings → Environment Variables) to the store key from Bcon → Merchants → your store → Copy Generated Keys.",
      `Enter ${callbackUrl} in every callback field the Bcon store form shows, then save.`,
    ];
    return report;
  }

  let storeEntry: any = null;
  try {
    const json = await bconGet("stores/get_store");
    const entries = json?.data?.addresses;
    storeEntry = Array.isArray(entries) && entries.length ? entries[0] : null;
    report.store = storeEntry ? normalizeBconStore(storeEntry) : null;
  } catch (error: any) {
    report.error = error.message || "Could not read the Bcon store";
    report.unverified.push("The Bcon store could not be read, so no chain can be verified right now.");
    report.correctiveActions = [
      "Check that BCON_API_KEY is valid and that the Bcon API is reachable from this deployment, then re-check.",
    ];
    return report;
  }

  if (!report.store) {
    report.error = "BCON_API_KEY did not resolve to a store";
    report.correctiveActions = ["Copy a valid per-store API key from the Bcon dashboard into BCON_API_KEY."];
    return report;
  }

  report.chains = report.store.chains.map((chain) => ({
    chain: chain.chain,
    code: chain.code,
    callbackUrl: chain.callbackUrl,
    hasApiKey: chain.hasApiKey,
    callbackMatchesSite: chain.callbackUrl === callbackUrl,
  }));

  const storeFieldValues = bconStoreCallbackFieldValues(storeEntry);
  const storeChainCodes = new Set(report.chains.map((chain) => chain.code));

  report.callbackFields = report.callbackFields.map((field) => {
    const actual = storeFieldValues[field.apiField] ?? null;
    const reportedByStore = storeChainCodes.has(field.code) || actual !== null;
    return { ...field, actual, matchesExpected: actual === field.value, reportedByStore };
  });

  report.missingCallbackChains = report.chains.filter((chain) => !chain.callbackUrl).map((chain) => chain.code);
  report.mismatchedCallbackChains = report.chains
    .filter((chain) => chain.callbackUrl && chain.callbackUrl !== callbackUrl)
    .map((chain) => chain.code);

  if (report.missingCallbackChains.length) {
    report.correctiveActions.push(
      `Bcon reports these callback fields as empty: ${report.missingCallbackChains
        .map((code) => BCON_CALLBACK_FIELDS[code as BconChainCode]?.validationPath || `callback_url.${code}`)
        .join(", ")}. If the store form renders an input for them, it rejects the save with "The callback_url.<chain> must be a string." — either type ${callbackUrl} into each input or disable that chain in the same form.`
    );
  }
  if (report.mismatchedCallbackChains.length) {
    report.correctiveActions.push(
      `Replace the callback URL on these chains with ${callbackUrl}: ${report.mismatchedCallbackChains.join(", ")}.`
    );
  }
  const neverReported = report.callbackFields.filter((field) => !field.reportedByStore);
  if (neverReported.length) {
    report.unverified.push(
      `Bcon's store payload does not return these chains at all (${neverReported
        .map((field) => field.code)
        .join(", ")}). The API only returns chains that are configured — treat them as unverified, not as working.`
    );
  }
  if (!report.missingCallbackChains.length && !report.mismatchedCallbackChains.length) {
    report.correctiveActions.push(
      "Every chain Bcon reports has this app's callback URL. If the store form still refuses to save, check the other form fields (wallet address / xpub, API keys, enabled currencies) — they are not visible to this diagnostic."
    );
  }
  report.correctiveActions.push(
    "If you do not intend to accept a chain, disable it in the Bcon store form instead of leaving a rendered callback field empty."
  );

  return report;
}

/**
 * Reachability probe of our own callback endpoint.
 *
 * This is the only callback check that is verifiable from the application
 * side: Bcon's docs state "a callback succeeds when the server returns 200
 * HTTP status". It does NOT prove that Bcon has the URL configured.
 */
export async function probeBconCallbackEndpoint(siteUrl: string): Promise<{
  ok: boolean;
  url: string;
  status: number;
  body: string;
  error?: string;
}> {
  const url = bconCallbackUrl(siteUrl);
  if (!isValidBconCallbackUrl(url)) {
    return { ok: false, url, status: 0, body: "", error: "The callback URL is not an absolute URL for /api/bcon/callback" };
  }
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
    const body = (await res.text()).slice(0, 200);
    return { ok: res.status === 200, url, status: res.status, body };
  } catch (error: any) {
    return { ok: false, url, status: 0, body: "", error: error?.message || "Callback endpoint could not be reached" };
  }
}
