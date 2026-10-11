/**
 * Bcon Global API client — server-only.
 *
 * The callback URL is configured on the Bcon store itself, not per address
 * request. Keep the API key server-side and configure the same raw HTTPS URL
 * for every chain enabled on that store.
 *
 * Docs: https://bcon.global/integrations/api/
 */

import { randomUUID } from "crypto";

const BCON_BASE = "https://external-api.bcon.global/api/v2";

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
  status?: string;
  external_id?: string;
  currency?: string;
  chain?: string;
  secret?: string;
  // plus any other callback fields
  [key: string]: string | undefined;
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
