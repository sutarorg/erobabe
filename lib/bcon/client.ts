/**
 * Bcon Global API client — server-only.
 *
 * A Bcon store carries ONE callback URL PER BLOCKCHAIN (`callback_url` for BTC,
 * `callback_url_bnb` for BNB, and a `callback_url_<code>` entry for every other
 * enabled chain), not a single shared one. Bcon's own docs note that "by
 * default it returns information on BTC and BNB even if they are empty", so the
 * store form always validates those two chains plus whichever ones you enable.
 * That is why a half-filled form comes back with
 * `The callback_url.btc must be a string. (and 2 more errors)`.
 *
 * Keep the API key server-side and configure the same raw HTTPS URL for every
 * chain present on the store.
 *
 * Docs: https://bcon.global/integrations/api/
 */

import { randomUUID } from "crypto";

const BCON_API_V1 = "https://external-api.bcon.global/api/v1";
const BCON_BASE = "https://external-api.bcon.global/api/v2";

/** Bcon identifies chains by a short code in store config and API keys. */
export const BCON_CHAIN_CODES = {
  bitcoin: "btc",
  binance: "bnb",
  ethereum: "eth",
  tron: "trx",
  solana: "sol",
} as const;

export type BconChain = keyof typeof BCON_CHAIN_CODES;
export const BCON_CHAINS = Object.keys(BCON_CHAIN_CODES) as BconChain[];

export function bconChainCode(chain: string): string {
  const normalized = String(chain || "").trim().toLowerCase();
  return (BCON_CHAIN_CODES as Record<string, string>)[normalized] || normalized;
}

/** The single callback URL every chain on the Bcon store must be pointed at. */
export function bconCallbackUrl(siteUrl: string): string {
  const origin = String(siteUrl || "").trim().replace(/\/+$/, "");
  return `${origin}/api/bcon/callback`;
}

/**
 * Bcon's merchant-platforms form validates `callback_url` as an OBJECT of
 * per-chain strings (`callback_url.btc`, `callback_url.bnb`, …). Pasting a
 * bare URL string into that field produces:
 *   "The callback_url.btc must be a string. (and 2 more errors)"
 * because `.btc` on a string is undefined.
 *
 * Every value here is a non-empty string — never null, never nested.
 */
export type BconCallbackUrlMap = {
  btc: string;
  bnb: string;
  eth: string;
  trx: string;
  sol: string;
};

export function bconCallbackUrlMap(siteUrl: string): BconCallbackUrlMap {
  const url = bconCallbackUrl(siteUrl);
  if (typeof url !== "string" || !url.startsWith("http")) {
    throw new Error("callback_url.btc must be a string");
  }
  const map: BconCallbackUrlMap = { btc: url, bnb: url, eth: url, trx: url, sol: url };
  for (const [code, value] of Object.entries(map)) {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`callback_url.${code} must be a string`);
    }
  }
  return map;
}

export function bconMerchantCallbackPayload(siteUrl: string): { callback_url: BconCallbackUrlMap } {
  return { callback_url: bconCallbackUrlMap(siteUrl) };
}

export interface BconCreateAddressParams {
  payment_currency: string; // USDT, USDC, BTC...
  origin_amount: string; // e.g. "99"
  origin_currency: string; // USD
  external_id: string; // Bcon returns this to us in its callback (max 8 chars)
  chain: string; // ethereum | tron | binance | bitcoin | solana
  payment_amount?: string;
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

  const res = await fetch(`${BCON_BASE}/address`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(params),
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

export interface BconCallbackQuery {
  addr?: string;
  address?: string;
  txid?: string;
  transaction_id?: string;
  value?: string;
  amount?: string;
  /** Bcon's Test Payment endpoint posts the amount as `sum`. */
  sum?: string;
  status?: string;
  external_id?: string;
  currency?: string;
  currency_id?: string;
  chain?: string;
  store_id?: string;
  memo?: string;
  secret?: string;
  // plus any other callback fields
  [key: string]: string | undefined;
}

/**
 * Amount received, whichever field Bcon used. The live callback sends `value`
 * (satoshis for BTC); the Test Payment endpoint and some store payloads use
 * `sum` instead.
 */
export function bconCallbackAmount(callback: BconCallbackQuery): string | undefined {
  return callback.value || callback.amount || callback.sum;
}

/**
 * Validate callback — Bcon docs example uses query params with addr, txid,
 * value and external_id. Incoming values remain untrusted until verified
 * against our payment records.
 */
export function parseBconCallback(url: URL): BconCallbackQuery {
  const q: BconCallbackQuery = {};
  url.searchParams.forEach((v, k) => {
    q[k] = v;
  });
  return q;
}

export type BconTxStatus = "unconfirmed" | "partially_confirmed" | "confirmed" | "failed";

export function mapBconStatus(rawStatus?: string): BconTxStatus {
  if (!rawStatus) return "unconfirmed";
  const s = rawStatus.toLowerCase();
  if ((s.includes("confirm") && s.includes("partial")) || s === "1") return "partially_confirmed";
  if (s === "confirmed" || s === "2" || s === "ok") return "confirmed";
  if (s === "unconfirmed" || s === "0") return "unconfirmed";
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

/** Normalises one entry of Bcon's `data.addresses[]` store payload. */
export function normalizeBconStore(entry: any): BconStore {
  const chains: BconChainConfig[] = Array.isArray(entry?.chains)
    ? entry.chains.map((chain: any) => ({
        chain: String(chain?.chain || ""),
        code: String(chain?.code || bconChainCode(chain?.chain || "")),
        callbackUrl: typeof chain?.callback_url === "string" && chain.callback_url.trim() ? chain.callback_url.trim() : null,
        hasApiKey: Boolean(chain?.api_key),
      }))
    : [];

  // Older store payloads expose only the flat BTC/BNB columns.
  if (!chains.length) {
    const flat: Array<[string, string, unknown, unknown]> = [
      ["bitcoin", "btc", entry?.callback_url, entry?.api_key],
      ["binance", "bnb", entry?.callback_url_bnb, entry?.api_key_bnb],
    ];
    for (const [chain, code, callbackUrl, apiKey] of flat) {
      chains.push({
        chain,
        code,
        callbackUrl: typeof callbackUrl === "string" && callbackUrl.trim() ? callbackUrl.trim() : null,
        hasApiKey: Boolean(apiKey),
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

export interface BconChainCheck {
  chain: string;
  code: string;
  callbackUrl: string | null;
  hasApiKey: boolean;
  /** True when the chain's callback URL is exactly the one this app serves. */
  callbackMatchesSite: boolean;
}

export interface BconSetupReport {
  configured: boolean;
  callbackUrl: string;
  /** Per-chain strings for Bcon's merchant-platforms `callback_url` object. */
  callbackUrlMap: BconCallbackUrlMap;
  merchantPayload: { callback_url: BconCallbackUrlMap };
  expectedChain: string;
  expectedChainCode: string;
  paymentCurrency: string;
  store: BconStore | null;
  chains: BconChainCheck[];
  /** Chains present on the store whose callback URL is missing — the exact
   *  fields Bcon's form rejects with `callback_url.<code> must be a string`. */
  missingCallbackChains: string[];
  error?: string;
}

/**
 * Compares the live Bcon store against this deployment's configuration so the
 * admin can see precisely which `callback_url.<chain>` fields still need to be
 * filled in on the Bcon dashboard.
 */
export async function inspectBconSetup(siteUrl: string): Promise<BconSetupReport> {
  const callbackUrl = bconCallbackUrl(siteUrl);
  const callbackUrlMap = bconCallbackUrlMap(siteUrl);
  const merchantPayload = { callback_url: callbackUrlMap };
  const expectedChain = (process.env.BCON_CHAIN || "ethereum").trim().toLowerCase();
  const expectedChainCode = bconChainCode(expectedChain);

  const report: BconSetupReport = {
    configured: Boolean(process.env.BCON_API_KEY),
    callbackUrl,
    callbackUrlMap,
    merchantPayload,
    expectedChain,
    expectedChainCode,
    paymentCurrency: (process.env.BCON_PAYMENT_CURRENCY || "USDT").toUpperCase(),
    store: null,
    chains: [],
    missingCallbackChains: [],
  };
  if (!report.configured) {
    report.error = "BCON_API_KEY is not set";
    return report;
  }

  try {
    report.store = await getBconStore();
  } catch (error: any) {
    report.error = error.message || "Could not read the Bcon store";
    return report;
  }

  report.chains = (report.store?.chains || []).map((chain) => ({
    chain: chain.chain,
    code: chain.code,
    callbackUrl: chain.callbackUrl,
    hasApiKey: chain.hasApiKey,
    callbackMatchesSite: chain.callbackUrl === callbackUrl,
  }));
  report.missingCallbackChains = report.chains.filter((chain) => !chain.callbackUrl).map((chain) => chain.code);
  return report;
}

async function bconJson(method: string, path: string, body: unknown): Promise<{ ok: boolean; status: number; json: any; text: string }> {
  const apiKey = process.env.BCON_API_KEY;
  if (!apiKey) throw new Error("Missing BCON_API_KEY");

  const res = await fetch(`${BCON_API_V1}/${path.replace(/^\/+/, "")}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}

/**
 * Pushes the per-chain callback URL object (all values strings) to Bcon so
 * merchant-platforms stops rejecting the store with
 * `The callback_url.btc must be a string`.
 */
export async function applyBconStoreCallbacks(siteUrl: string): Promise<{
  ok: boolean;
  applied: boolean;
  status?: number;
  error?: string;
  payload: { callback_url: BconCallbackUrlMap };
}> {
  const payload = bconMerchantCallbackPayload(siteUrl);
  const store = await getBconStore().catch(() => null);
  const paths = [
    store?.id ? `stores/${store.id}` : "",
    "stores",
    "stores/update",
    "stores/get_store",
  ].filter(Boolean);

  let lastError = "Bcon did not accept a store update";
  let lastStatus: number | undefined;
  for (const path of paths) {
    for (const method of ["PUT", "PATCH", "POST"]) {
      const result = await bconJson(method, path, payload);
      lastStatus = result.status;
      if (result.ok) {
        return { ok: true, applied: true, status: result.status, payload };
      }
      const message =
        (typeof result.json?.message === "string" && result.json.message) ||
        (typeof result.json?.error === "string" && result.json.error) ||
        result.text.slice(0, 200);
      lastError = `Bcon API ${method} /${path} → ${result.status}${message ? `: ${message}` : ""}`;
      // 404/405 mean "this verb/path isn't the store update endpoint" — try the next.
      if (result.status !== 404 && result.status !== 405 && result.status !== 422) {
        // Other errors (401, 500) are not worth retrying across every combo.
        if (result.status === 401 || result.status === 403) {
          return { ok: false, applied: false, status: result.status, error: lastError, payload };
        }
      }
    }
  }

  return { ok: false, applied: false, status: lastStatus, error: lastError, payload };
}
