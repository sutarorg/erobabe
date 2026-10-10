/**
 * Bcon Global API client — server-only
 * Docs: https://bcon.global/integrations/api/
 *
 * Required env:
 * - BCON_API_KEY (per chain store key, for this launch we use one key and chain param)
 * - BCON_CHAIN (e.g. ethereum, tron, binance, bitcoin)
 * - BCON_PAYMENT_CURRENCY (e.g. USDT, USDC)
 */

const BCON_BASE = "https://external-api.bcon.global/api/v2";

export interface BconCreateAddressParams {
  payment_currency: string; // USDT, USDC, BTC...
  origin_amount: string; // e.g. "99"
  origin_currency: string; // USD
  external_id: string; // our internal reference (invoice_number or payment external_id)
  chain: string; // ethereum | tron | binance | bitcoin | solana
  payment_amount?: string;
}

export interface BconCreateAddressResponse {
  status: string;
  data?: {
    address: string;
    amount: string;
    currency: string;
    chain?: string;
    external_id?: string;
  };
  // actual response shape varies, we handle generically
  [key: string]: any;
}

export async function createBconPaymentAddress(
  params: BconCreateAddressParams
): Promise<{ address: string; amount: string; raw: any }> {
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
  });

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(`Bcon API error ${res.status}: ${JSON.stringify(json)}`);
  }

  // Response handling: docs show various shapes. Try to extract address.
  // Expected: { status: "Ok", data: { address, ... } } or similar
  const address =
    json?.data?.address || json?.address || json?.result?.address;

  if (!address) {
    throw new Error(`Bcon: no address in response: ${JSON.stringify(json)}`);
  }

  const amount = json?.data?.amount || json?.amount || params.origin_amount;

  return { address, amount: String(amount), raw: json };
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
  // plus any other
  [key: string]: string | undefined;
}

/**
 * Validate callback — Bcon docs example uses query params with addr, txid, value.
 * We treat incoming as untrusted and verify against our DB records.
 * There is no documented HMAC signature, so we verify:
 * - payment_address matches
 * - external_id exists
 * - expected amount matches (with tolerance)
 * - transaction_id not already processed
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
  if (s.includes("confirm") && s.includes("partial")) return "partially_confirmed";
  if (s === "confirmed" || s === "2" || s === "ok") return "confirmed";
  if (s === "unconfirmed" || s === "0" || s === "1") return "unconfirmed";
  return "unconfirmed";
}
