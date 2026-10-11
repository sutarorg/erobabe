import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  canonicalIpnJson,
  checkNowpaymentsApi,
  compareCryptoAmounts,
  computeNowpaymentsSignature,
  createNowpaymentsPayment,
  getNowpaymentsPayment,
  inspectNowpaymentsSetup,
  isSuccessfulNowpaymentsStatus,
  isTerminalNowpaymentsStatus,
  isValidNowpaymentsIpnUrl,
  mapNowpaymentsStatus,
  normalizeNowpaymentsPayload,
  nowpaymentsCheckoutChoices,
  nowpaymentsIpnUrl,
  nowpaymentsIpnUrlSource,
  nowpaymentsSupportedPayCurrencies,
  payCurrencyChoice,
  resolvePayCurrency,
  verifyNowpaymentsSignature,
  NowpaymentsApiError,
} from "@/lib/nowpayments/client";

const ENV_KEYS = [
  "NOWPAYMENTS_API_KEY",
  "NOWPAYMENTS_IPN_SECRET",
  "NOWPAYMENTS_DEFAULT_PAY_CURRENCY",
  "NOWPAYMENTS_IPN_CALLBACK_URL",
] as const;
const original: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) original[key] = process.env[key];

function resetEnv() {
  for (const key of ENV_KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => {
  resetEnv();
});

afterEach(() => {
  resetEnv();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("currency / network mapping", () => {
  it("resolves every supported asset/network combination explicitly", () => {
    expect(resolvePayCurrency("USDT", "ethereum")).toMatchObject({ ok: true, choice: { payCurrency: "usdterc20" } });
    expect(resolvePayCurrency("USDT", "tron")).toMatchObject({ ok: true, choice: { payCurrency: "usdttrc20" } });
    expect(resolvePayCurrency("USDT", "binance")).toMatchObject({ ok: true, choice: { payCurrency: "usdtbsc" } });
    expect(resolvePayCurrency("USDT", "solana")).toMatchObject({ ok: true, choice: { payCurrency: "usdtsol" } });
    expect(resolvePayCurrency("BTC", "bitcoin")).toMatchObject({ ok: true, choice: { payCurrency: "btc" } });
    expect(resolvePayCurrency("ETH", "ethereum")).toMatchObject({ ok: true, choice: { payCurrency: "eth" } });
    expect(resolvePayCurrency("TRX", "tron")).toMatchObject({ ok: true, choice: { payCurrency: "trx" } });
    expect(resolvePayCurrency("BNB", "binance")).toMatchObject({ ok: true, choice: { payCurrency: "bnbbsc" } });
    expect(resolvePayCurrency("SOL", "solana")).toMatchObject({ ok: true, choice: { payCurrency: "sol" } });
  });

  it("normalizes case without changing the mapping", () => {
    expect(resolvePayCurrency("usdt", "Ethereum")).toMatchObject({ ok: true, choice: { payCurrency: "usdterc20" } });
    expect(resolvePayCurrency("  btc ", "BITCOIN")).toMatchObject({ ok: true, choice: { payCurrency: "btc" } });
  });

  it("rejects unsupported combinations instead of substituting another asset", () => {
    const wrongChain = resolvePayCurrency("USDT", "bitcoin");
    expect(wrongChain.ok).toBe(false);
    if (!wrongChain.ok) expect(wrongChain.error).toMatch(/unsupported/i);

    const unknownAsset = resolvePayCurrency("DOGE", "ethereum");
    expect(unknownAsset.ok).toBe(false);

    const empty = resolvePayCurrency("", "");
    expect(empty.ok).toBe(false);
  });

  it("preserves the exact provider identifier through reverse lookup", () => {
    for (const choice of nowpaymentsCheckoutChoices()) {
      expect(payCurrencyChoice(choice.payCurrency)).toMatchObject({
        asset: choice.asset,
        chain: choice.chain,
        payCurrency: choice.payCurrency,
      });
    }
    expect(payCurrencyChoice("doge")).toBeNull();
    expect(nowpaymentsSupportedPayCurrencies()).toContain("usdterc20");
  });
});

describe("status mapping", () => {
  it("maps every documented NOWPayments status explicitly", () => {
    expect(mapNowpaymentsStatus("waiting")).toBe("awaiting_confirmation");
    expect(mapNowpaymentsStatus("confirming")).toBe("partially_confirmed");
    expect(mapNowpaymentsStatus("confirmed")).toBe("partially_confirmed");
    expect(mapNowpaymentsStatus("sending")).toBe("partially_confirmed");
    expect(mapNowpaymentsStatus("partially_paid")).toBe("underpaid");
    expect(mapNowpaymentsStatus("finished")).toBe("confirmed");
    expect(mapNowpaymentsStatus("failed")).toBe("failed");
    expect(mapNowpaymentsStatus("refunded")).toBe("refunded");
    expect(mapNowpaymentsStatus("expired")).toBe("expired");
  });

  it("never treats unknown statuses as success", () => {
    expect(mapNowpaymentsStatus("")).toBeNull();
    expect(mapNowpaymentsStatus(undefined)).toBeNull();
    expect(mapNowpaymentsStatus("something-else")).toBeNull();
    expect(mapNowpaymentsStatus("FINISHED")).toBe("confirmed");
  });

  it("distinguishes confirmed (intermediate) from finished (complete)", () => {
    expect(isSuccessfulNowpaymentsStatus("finished")).toBe(true);
    expect(isSuccessfulNowpaymentsStatus("confirmed")).toBe(false);
    expect(isSuccessfulNowpaymentsStatus("sending")).toBe(false);
    expect(isSuccessfulNowpaymentsStatus("partially_paid")).toBe(false);

    expect(isTerminalNowpaymentsStatus("finished")).toBe(true);
    expect(isTerminalNowpaymentsStatus("failed")).toBe(true);
    expect(isTerminalNowpaymentsStatus("refunded")).toBe(true);
    expect(isTerminalNowpaymentsStatus("expired")).toBe(true);
    // Processed as terminal (manual review) so it is corroborated and recorded.
    expect(isTerminalNowpaymentsStatus("partially_paid")).toBe(true);
    expect(isTerminalNowpaymentsStatus("waiting")).toBe(false);
    expect(isTerminalNowpaymentsStatus("confirming")).toBe(false);
    expect(isTerminalNowpaymentsStatus("confirmed")).toBe(false);
    expect(isTerminalNowpaymentsStatus("sending")).toBe(false);
  });
});

describe("decimal-safe amount comparison", () => {
  it("matches exact and within-tolerance amounts", () => {
    expect(compareCryptoAmounts("99.5", "99.5")).toBe("match");
    expect(compareCryptoAmounts(99.5, "99.5")).toBe("match");
    expect(compareCryptoAmounts("99.0", "99.5")).toBe("match"); // within 2%
    expect(compareCryptoAmounts("100.9", "99.5")).toBe("match");
  });

  it("detects under and over payments", () => {
    expect(compareCryptoAmounts("50", "99.5")).toBe("underpaid");
    expect(compareCryptoAmounts("120", "99.5")).toBe("overpaid");
  });

  it("avoids floating-point rounding errors", () => {
    // 0.1 + 0.2 in IEEE-754 is 0.30000000000000004 — integer math must still match.
    expect(compareCryptoAmounts("0.30000000000000004", "0.3")).toBe("match");
    expect(compareCryptoAmounts("0.1", "0.3")).toBe("underpaid");
  });

  it("returns unknown for missing or invalid amounts", () => {
    expect(compareCryptoAmounts(null, "99.5")).toBe("unknown");
    expect(compareCryptoAmounts("99.5", null)).toBe("unknown");
    expect(compareCryptoAmounts("not-a-number", "99.5")).toBe("unknown");
    expect(compareCryptoAmounts("99.5", "0")).toBe("unknown");
    expect(compareCryptoAmounts("99.5", "-5")).toBe("unknown");
  });
});

describe("payment creation", () => {
  const params = {
    priceAmount: "99.00",
    priceCurrency: "usd",
    payCurrency: "usdterc20",
    orderId: "INV-123",
    orderDescription: "Erobabe advertising slots 1 — 1 month",
    ipnCallbackUrl: "https://erobabe.vercel.app/api/nowpayments/ipn",
  };

  function providerPayment(overrides: Record<string, unknown> = {}) {
    return {
      payment_id: "5730453421",
      payment_status: "waiting",
      pay_address: "0xPayAddress",
      price_amount: 99,
      price_currency: "usd",
      pay_amount: 99.5,
      pay_currency: "usdterc20",
      order_id: "INV-123",
      order_description: "Erobabe advertising slots 1 — 1 month",
      ipn_callback_url: params.ipnCallbackUrl,
      ...overrides,
    };
  }

  it("sends x-api-key and the documented payload, and preserves id/correlation", async () => {
    process.env.NOWPAYMENTS_API_KEY = "test-key";
    const fetchSpy = stubFetch(() => jsonResponse(providerPayment()));

    const payment = await createNowpaymentsPayment(params);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.nowpayments.io/v1/payment");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("test-key");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      price_amount: 99,
      price_currency: "usd",
      pay_currency: "usdterc20",
      order_id: "INV-123",
      ipn_callback_url: params.ipnCallbackUrl,
    });

    expect(payment.paymentId).toBe("5730453421");
    expect(payment.orderId).toBe("INV-123");
    expect(payment.payAddress).toBe("0xPayAddress");
    expect(payment.payAmount).toBe("99.5");
    expect(payment.payCurrency).toBe("usdterc20");
    expect(payment.providerStatus).toBe("waiting");
  });

  it("throws when the API key is missing", async () => {
    delete process.env.NOWPAYMENTS_API_KEY;
    const fetchSpy = stubFetch(() => jsonResponse(providerPayment()));
    await expect(createNowpaymentsPayment(params)).rejects.toThrow(/NOWPAYMENTS_API_KEY/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects unsupported pay currencies before calling the provider", async () => {
    process.env.NOWPAYMENTS_API_KEY = "test-key";
    const fetchSpy = stubFetch(() => jsonResponse(providerPayment()));
    await expect(createNowpaymentsPayment({ ...params, payCurrency: "doge" })).rejects.toThrow(/not supported/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects invalid amounts and callback URLs before calling the provider", async () => {
    process.env.NOWPAYMENTS_API_KEY = "test-key";
    const fetchSpy = stubFetch(() => jsonResponse(providerPayment()));
    await expect(createNowpaymentsPayment({ ...params, priceAmount: "0" })).rejects.toThrow(/positive decimal/);
    await expect(createNowpaymentsPayment({ ...params, priceAmount: "abc" })).rejects.toThrow(/positive decimal/);
    await expect(createNowpaymentsPayment({ ...params, ipnCallbackUrl: "https://evil.example/hook" })).rejects.toThrow(
      /ipn_callback_url/
    );
    await expect(createNowpaymentsPayment({ ...params, orderId: "" })).rejects.toThrow(/order_id/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("surfaces provider errors without inventing a payment", async () => {
    process.env.NOWPAYMENTS_API_KEY = "test-key";
    stubFetch(() => jsonResponse({ message: "pay_currency not available" }, 400));
    const error = await createNowpaymentsPayment(params).catch((e) => e);
    expect(error).toBeInstanceOf(NowpaymentsApiError);
    expect(error.message).toMatch(/pay_currency not available/);
    expect(error.retryable).toBe(false);
  });

  it("marks rate limits and server errors retryable", async () => {
    process.env.NOWPAYMENTS_API_KEY = "test-key";
    stubFetch(() => jsonResponse({ message: "slow down" }, 429));
    const rateLimited = await createNowpaymentsPayment(params).catch((e) => e);
    expect(rateLimited.retryable).toBe(true);

    stubFetch(() => jsonResponse({}, 500));
    const serverError = await createNowpaymentsPayment(params).catch((e) => e);
    expect(serverError.retryable).toBe(true);
  });

  it("rejects invalid provider responses", async () => {
    process.env.NOWPAYMENTS_API_KEY = "test-key";
    stubFetch(() => jsonResponse({ payment_status: "waiting" })); // no payment_id/address
    await expect(createNowpaymentsPayment(params)).rejects.toThrow(/invalid payment response/);

    stubFetch(() => jsonResponse({ payment_id: "1", pay_address: "0x", payment_status: "waiting" })); // no pay_amount
    await expect(createNowpaymentsPayment(params)).rejects.toThrow(/invalid payment response/);
  });

  it("treats network failures as retryable", async () => {
    process.env.NOWPAYMENTS_API_KEY = "test-key";
    stubFetch(() => {
      throw new Error("boom");
    });
    const error = await createNowpaymentsPayment(params).catch((e) => e);
    expect(error.retryable).toBe(true);
  });
});

describe("payment lookup and connectivity check", () => {
  it("fetches a payment by id for corroboration", async () => {
    process.env.NOWPAYMENTS_API_KEY = "test-key";
    const fetchSpy = stubFetch((url) => {
      expect(url).toBe("https://api.nowpayments.io/v1/payment/5730453421");
      return jsonResponse({ payment_id: "5730453421", payment_status: "finished", pay_amount: "99.5" });
    });
    const lookup = await getNowpaymentsPayment("5730453421");
    expect(lookup.ok).toBe(true);
    if (lookup.ok) expect(lookup.payment.providerStatus).toBe("finished");
    expect((fetchSpy.mock.calls[0][1] as RequestInit).method).toBe("GET");
  });

  it("distinguishes not-found from transient API errors", async () => {
    process.env.NOWPAYMENTS_API_KEY = "test-key";
    stubFetch(() => jsonResponse({ message: "not found" }, 404));
    expect(await getNowpaymentsPayment("nope")).toMatchObject({ ok: false, reason: "not_found" });

    stubFetch(() => jsonResponse({}, 503));
    expect(await getNowpaymentsPayment("5730453421")).toMatchObject({ ok: false, reason: "api_error", retryable: true });
  });

  it("checks connectivity without creating a payment", async () => {
    process.env.NOWPAYMENTS_API_KEY = "test-key";
    const fetchSpy = stubFetch((url) => {
      expect(url).toBe("https://api.nowpayments.io/v1/status");
      return jsonResponse({ message: "OK" });
    });
    expect(await checkNowpaymentsApi()).toMatchObject({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("reports a missing key instead of calling the API", async () => {
    delete process.env.NOWPAYMENTS_API_KEY;
    const fetchSpy = stubFetch(() => jsonResponse({ message: "OK" }));
    expect(await checkNowpaymentsApi()).toMatchObject({ ok: false, message: expect.stringMatching(/NOWPAYMENTS_API_KEY/) });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("IPN signature verification", () => {
  const SECRET = "test-ipn-secret";
  const payload = {
    payment_id: "5730453421",
    payment_status: "finished",
    pay_address: "0xPayAddress",
    price_amount: 99,
    price_currency: "usd",
    pay_amount: 99.5,
    actually_paid: 99.5,
    pay_currency: "usdterc20",
    order_id: "INV-123",
  };

  function signedBody(body: unknown, secret = SECRET): { raw: string; sig: string } {
    const raw = JSON.stringify(body);
    const parsed = JSON.parse(raw);
    return { raw, sig: computeNowpaymentsSignature(parsed, secret) };
  }

  it("accepts a valid signature", () => {
    const { raw, sig } = signedBody(payload);
    expect(verifyNowpaymentsSignature(raw, sig, SECRET)).toMatchObject({ ok: true });
  });

  it("is independent of key order in the transmitted body", () => {
    const reordered = {
      order_id: "INV-123",
      pay_currency: "usdterc20",
      payment_status: "finished",
      payment_id: "5730453421",
      pay_address: "0xPayAddress",
      price_amount: 99,
      price_currency: "usd",
      pay_amount: 99.5,
      actually_paid: 99.5,
    };
    const { raw, sig } = signedBody(reordered);
    expect(verifyNowpaymentsSignature(raw, sig, SECRET)).toMatchObject({ ok: true });
    // Canonical form sorts keys, so both bodies share one signature.
    expect(canonicalIpnJson(payload)).toBe(canonicalIpnJson(reordered));
  });

  it("rejects a missing signature", () => {
    const { raw } = signedBody(payload);
    expect(verifyNowpaymentsSignature(raw, null, SECRET)).toMatchObject({ ok: false, error: "Missing IPN signature" });
    expect(verifyNowpaymentsSignature(raw, "", SECRET)).toMatchObject({ ok: false, error: "Missing IPN signature" });
  });

  it("rejects malformed signatures", () => {
    const { raw } = signedBody(payload);
    expect(verifyNowpaymentsSignature(raw, "not-hex", SECRET)).toMatchObject({ ok: false, error: "Malformed IPN signature" });
    expect(verifyNowpaymentsSignature(raw, "ab".repeat(10), SECRET)).toMatchObject({ ok: false, error: "Malformed IPN signature" });
  });

  it("rejects an invalid signature", () => {
    const { raw } = signedBody(payload);
    expect(verifyNowpaymentsSignature(raw, "ab".repeat(64), SECRET)).toMatchObject({ ok: false, error: "Invalid IPN signature" });
  });

  it("rejects a tampered payload", () => {
    const { sig } = signedBody(payload);
    const tampered = JSON.stringify({ ...payload, payment_status: "finished", pay_amount: 0.01 });
    expect(verifyNowpaymentsSignature(tampered, sig, SECRET)).toMatchObject({ ok: false, error: "Invalid IPN signature" });
  });

  it("rejects a signature made with the wrong secret", () => {
    const { raw } = signedBody(payload, "another-secret");
    const parsed = JSON.parse(raw);
    const wrongSig = computeNowpaymentsSignature(parsed, "another-secret");
    expect(verifyNowpaymentsSignature(raw, wrongSig, SECRET)).toMatchObject({ ok: false, error: "Invalid IPN signature" });
  });

  it("rejects malformed bodies", () => {
    expect(verifyNowpaymentsSignature("not json", "ab".repeat(64), SECRET)).toMatchObject({ ok: false, error: "Malformed IPN body" });
    expect(verifyNowpaymentsSignature("[1,2,3]", "ab".repeat(64), SECRET)).toMatchObject({ ok: false, error: "Malformed IPN body" });
  });

  it("fails closed when the IPN secret is not configured", () => {
    delete process.env.NOWPAYMENTS_IPN_SECRET;
    const { raw, sig } = signedBody(payload);
    expect(verifyNowpaymentsSignature(raw, sig)).toMatchObject({ ok: false, error: "IPN secret is not configured" });
  });

  it("reads the secret from the environment by default", () => {
    process.env.NOWPAYMENTS_IPN_SECRET = SECRET;
    const { raw, sig } = signedBody(payload);
    expect(verifyNowpaymentsSignature(raw, sig)).toMatchObject({ ok: true });
  });
});

describe("payload normalization and correlation", () => {
  it("normalizes numbers to strings and keeps the raw payload", () => {
    const payment = normalizeNowpaymentsPayload({
      payment_id: "5730453421",
      payment_status: "finished",
      pay_amount: 99.5,
      actually_paid: 99.5,
      price_amount: 99,
    });
    expect(payment).toMatchObject({
      paymentId: "5730453421",
      providerStatus: "finished",
      payAmount: "99.5",
      actuallyPaid: "99.5",
      priceAmount: "99",
    });
    expect(payment?.raw).toHaveProperty("payment_id", "5730453421");
  });

  it("rejects payloads without a payment id", () => {
    expect(normalizeNowpaymentsPayload({ payment_status: "finished" })).toBeNull();
    expect(normalizeNowpaymentsPayload(null)).toBeNull();
    expect(normalizeNowpaymentsPayload([])).toBeNull();
  });
});

describe("IPN callback URL", () => {
  it("derives the URL from the site origin", () => {
    expect(nowpaymentsIpnUrl("https://erobabe.vercel.app")).toBe("https://erobabe.vercel.app/api/nowpayments/ipn");
    expect(nowpaymentsIpnUrl("https://erobabe.vercel.app/")).toBe("https://erobabe.vercel.app/api/nowpayments/ipn");
  });

  it("honours only a valid override", () => {
    expect(nowpaymentsIpnUrl("https://erobabe.vercel.app", "https://payments.example.com/api/nowpayments/ipn")).toBe(
      "https://payments.example.com/api/nowpayments/ipn"
    );
    expect(nowpaymentsIpnUrl("https://erobabe.vercel.app", "not-a-url")).toBe(
      "https://erobabe.vercel.app/api/nowpayments/ipn"
    );
    expect(isValidNowpaymentsIpnUrl("https://erobabe.vercel.app/api/nowpayments/ipn")).toBe(true);
    expect(isValidNowpaymentsIpnUrl("https://erobabe.vercel.app/api/bcon/callback")).toBe(false);
  });

  it("reports which variable produced the URL", () => {
    process.env.NOWPAYMENTS_IPN_CALLBACK_URL = "https://erobabe.vercel.app/api/nowpayments/ipn";
    expect(nowpaymentsIpnUrlSource()).toBe("NOWPAYMENTS_IPN_CALLBACK_URL");
    delete process.env.NOWPAYMENTS_IPN_CALLBACK_URL;
    expect(nowpaymentsIpnUrlSource()).toBe("NEXT_PUBLIC_SITE_URL");
  });
});

describe("setup inspection", () => {
  it("reports a missing API key with corrective actions", async () => {
    delete process.env.NOWPAYMENTS_API_KEY;
    const report = await inspectNowpaymentsSetup("https://erobabe.vercel.app");
    expect(report.apiKeyConfigured).toBe(false);
    expect(report.error).toMatch(/NOWPAYMENTS_API_KEY/);
    expect(report.correctiveActions.length).toBeGreaterThan(0);
    expect(report.ipnUrl).toBe("https://erobabe.vercel.app/api/nowpayments/ipn");
  });

  it("requires the IPN secret even when the API is reachable", async () => {
    process.env.NOWPAYMENTS_API_KEY = "test-key";
    delete process.env.NOWPAYMENTS_IPN_SECRET;
    stubFetch(() => jsonResponse({ message: "OK" }));
    const report = await inspectNowpaymentsSetup("https://erobabe.vercel.app");
    expect(report.apiReachable).toBe(true);
    expect(report.ipnSecretConfigured).toBe(false);
    expect(report.correctiveActions.join(" ")).toMatch(/NOWPAYMENTS_IPN_SECRET/);
  });

  it("flags an invalid default pay currency", async () => {
    process.env.NOWPAYMENTS_API_KEY = "test-key";
    process.env.NOWPAYMENTS_IPN_SECRET = "secret";
    process.env.NOWPAYMENTS_DEFAULT_PAY_CURRENCY = "doge";
    stubFetch((url) =>
      url.endsWith("/status") ? jsonResponse({ message: "OK" }) : jsonResponse({ currencies: ["btc", "usdterc20"] })
    );
    const report = await inspectNowpaymentsSetup("https://erobabe.vercel.app");
    expect(report.defaultPayCurrencyValid).toBe(false);
    expect(report.configWarnings.join(" ")).toMatch(/NOWPAYMENTS_DEFAULT_PAY_CURRENCY/);
  });

  it("reports unreachable API without creating a payment", async () => {
    process.env.NOWPAYMENTS_API_KEY = "bad-key";
    process.env.NOWPAYMENTS_IPN_SECRET = "secret";
    const fetchSpy = stubFetch((url) => {
      expect(url).toBe("https://api.nowpayments.io/v1/status");
      return jsonResponse({ message: "Invalid API key" }, 401);
    });
    const report = await inspectNowpaymentsSetup("https://erobabe.vercel.app");
    expect(report.apiReachable).toBe(false);
    expect(report.error).toMatch(/Invalid API key/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
