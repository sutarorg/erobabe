import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  bconCallbackAmount,
  bconCallbackAmountInCoinUnits,
  bconCallbackFields,
  bconCallbackUrl,
  bconCallbackUrlMap,
  bconCallbackUrlSource,
  bconChainCode,
  bconCreateAddressPayload,
  bconStoreCallbackFieldValues,
  compareBconAmounts,
  createBconExternalId,
  getBconTransaction,
  inspectBconSetup,
  isValidBconCallbackUrl,
  mapBconStatus,
  normalizeBconStore,
  parseBconCallback,
  probeBconCallbackEndpoint,
} from "@/lib/bcon/client";

const ENV_KEYS = ["BCON_API_KEY", "BCON_CALLBACK_URL", "BCON_CHAIN", "BCON_PAYMENT_CURRENCY"] as const;
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

beforeEach(() => {
  resetEnv();
});

afterEach(() => {
  resetEnv();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("bcon client", () => {
  it("maps bcon statuses", () => {
    expect(mapBconStatus("confirmed")).toBe("confirmed");
    expect(mapBconStatus("unconfirmed")).toBe("unconfirmed");
    expect(mapBconStatus("partially_confirmed")).toBe("partially_confirmed");
    expect(mapBconStatus("1")).toBe("partially_confirmed");
    expect(mapBconStatus("2")).toBe("confirmed");
    expect(mapBconStatus("0")).toBe("unconfirmed");
    // Unknown or empty values are never treated as confirmed.
    expect(mapBconStatus("")).toBe("unconfirmed");
    expect(mapBconStatus(undefined)).toBe("unconfirmed");
    expect(mapBconStatus("something-else")).toBe("unconfirmed");
  });

  it("parses callback query", () => {
    const url = new URL("https://example.com/api/bcon/callback?addr=0x123&txid=0xabc&value=99&external_id=test-123&status=confirmed");
    const parsed = parseBconCallback(url);
    expect(parsed.addr).toBe("0x123");
    expect(parsed.txid).toBe("0xabc");
    expect(parsed.external_id).toBe("test-123");
  });

  it("creates an opaque external id accepted by Bcon", () => {
    const id = createBconExternalId();
    expect(id).toMatch(/^E[A-F0-9]{7}$/);
    expect(id).toHaveLength(8);
  });
});

describe("bcon store configuration", () => {
  it("maps chain names to the codes Bcon validates against", () => {
    expect(bconChainCode("bitcoin")).toBe("btc");
    expect(bconChainCode("binance")).toBe("bnb");
    expect(bconChainCode("ethereum")).toBe("eth");
    expect(bconChainCode("tron")).toBe("trx");
    expect(bconChainCode("solana")).toBe("sol");
    expect(bconChainCode("ETHEREUM")).toBe("eth");
  });

  it("builds the callback URL every chain must point at", () => {
    expect(bconCallbackUrl("https://erobabe.vercel.app")).toBe("https://erobabe.vercel.app/api/bcon/callback");
    expect(bconCallbackUrl("https://erobabe.vercel.app/")).toBe("https://erobabe.vercel.app/api/bcon/callback");
    expect(bconCallbackUrl("https://erobabe.vercel.app///")).toBe("https://erobabe.vercel.app/api/bcon/callback");
    expect(bconCallbackUrl("  https://erobabe.vercel.app/  ")).toBe("https://erobabe.vercel.app/api/bcon/callback");
  });

  it("uses BCON_CALLBACK_URL only when it is an absolute /api/bcon/callback URL", () => {
    expect(bconCallbackUrl("https://erobabe.vercel.app", "https://erobabe.vercel.app/api/bcon/callback")).toBe(
      "https://erobabe.vercel.app/api/bcon/callback"
    );
    expect(bconCallbackUrl("https://erobabe.vercel.app", "https://payments.example.com/api/bcon/callback")).toBe(
      "https://payments.example.com/api/bcon/callback"
    );
    // A misconfigured override is ignored rather than breaking callbacks.
    expect(bconCallbackUrl("https://erobabe.vercel.app", "not-a-url")).toBe("https://erobabe.vercel.app/api/bcon/callback");
    expect(bconCallbackUrl("https://erobabe.vercel.app", "https://erobabe.vercel.app/somewhere-else")).toBe(
      "https://erobabe.vercel.app/api/bcon/callback"
    );
    expect(isValidBconCallbackUrl("mailto:hi@erobabe.com")).toBe(false);
    expect(isValidBconCallbackUrl("https://erobabe.vercel.app/api/bcon/callback")).toBe(true);
    expect(isValidBconCallbackUrl("https://erobabe.vercel.app/api/bcon/callback/")).toBe(true);
    expect(isValidBconCallbackUrl("https://erobabe.vercel.app/api/Bcon/Callback")).toBe(true);
    expect(isValidBconCallbackUrl("")).toBe(false);
  });

  it("reports which environment variable produced the callback URL", () => {
    process.env.BCON_CALLBACK_URL = "https://erobabe.vercel.app/api/bcon/callback";
    expect(bconCallbackUrlSource()).toBe("BCON_CALLBACK_URL");
    delete process.env.BCON_CALLBACK_URL;
    expect(bconCallbackUrlSource()).toBe("NEXT_PUBLIC_SITE_URL");
  });

  it("maps every supported chain to the same https callback string", () => {
    const map = bconCallbackUrlMap("https://erobabe.vercel.app");
    expect(map).toEqual({
      btc: "https://erobabe.vercel.app/api/bcon/callback",
      bnb: "https://erobabe.vercel.app/api/bcon/callback",
      eth: "https://erobabe.vercel.app/api/bcon/callback",
      trx: "https://erobabe.vercel.app/api/bcon/callback",
      sol: "https://erobabe.vercel.app/api/bcon/callback",
    });
  });

  it("describes one plain string field per chain, using Bcon's documented names", () => {
    const fields = bconCallbackFields("https://erobabe.vercel.app");
    expect(fields.map((field) => field.code)).toEqual(["btc", "bnb", "eth", "trx", "sol"]);
    expect(fields.map((field) => field.apiField)).toEqual([
      "callback_url",
      "callback_url_bnb",
      "callback_url_eth",
      "callback_url_trx",
      "callback_url_sol",
    ]);
    expect(fields.map((field) => field.validationPath)).toEqual([
      "callback_url.btc",
      "callback_url.bnb",
      "callback_url.eth",
      "callback_url.trx",
      "callback_url.sol",
    ]);
    for (const field of fields) {
      expect(typeof field.value).toBe("string");
      expect(field.value).toBe("https://erobabe.vercel.app/api/bcon/callback");
      expect(Array.isArray(field.value)).toBe(false);
      expect(field.value.trim()).toBe(field.value);
    }
  });

  it("builds the callback URL map only from non-empty strings", () => {
    const map = bconCallbackUrlMap("https://erobabe.com/");
    for (const value of Object.values(map)) {
      expect(typeof value).toBe("string");
      expect(value.startsWith("https://")).toBe(true);
      expect(value).not.toContain(" ");
    }
  });

  it("reads the amount from value, amount, or sum", () => {
    expect(bconCallbackAmount({ value: "1537643" })).toBe("1537643");
    expect(bconCallbackAmount({ sum: "0.000005" })).toBe("0.000005");
    expect(bconCallbackAmount({})).toBeUndefined();
  });

  it("converts documented callback units before comparing amounts", () => {
    // Live BTC callbacks send satoshis.
    expect(bconCallbackAmountInCoinUnits("bitcoin", { value: "1537643" })).toEqual({
      amount: 0.01537643,
      source: "value",
      unitAdjusted: true,
    });
    // Test-payment `sum` is already in coin units.
    expect(bconCallbackAmountInCoinUnits("bitcoin", { sum: "0.000005" })).toEqual({
      amount: 0.000005,
      source: "sum",
      unitAdjusted: false,
    });
    expect(bconCallbackAmountInCoinUnits("ethereum", { value: "99.0" })).toEqual({
      amount: 99,
      source: "value",
      unitAdjusted: false,
    });
    expect(bconCallbackAmountInCoinUnits("ethereum", { value: "not-a-number" })).toBeNull();
    expect(bconCallbackAmountInCoinUnits("ethereum", {})).toBeNull();
  });

  it("compares expected and received amounts with a tolerance", () => {
    expect(compareBconAmounts("99.00", "99.00000000")).toBe("match");
    expect(compareBconAmounts("98.5", "99")).toBe("match");
    expect(compareBconAmounts("1.0", "99")).toBe("underpaid");
    expect(compareBconAmounts("150", "99")).toBe("overpaid");
    expect(compareBconAmounts("", "99")).toBe("unknown");
    expect(compareBconAmounts("99", "")).toBe("unknown");
    expect(compareBconAmounts("99", "0")).toBe("unknown");
  });

  it("parses the per-chain callback URLs from a store payload", () => {
    // Shape taken from Bcon's documented /api/v1/stores response.
    const store = normalizeBconStore({
      id: 1,
      name: "Opencart",
      tag: "test",
      api_key: "YourApikey",
      api_key_bnb: "YourApiKey1",
      callback_url: "https://yourdomain.com/callback",
      callback_url_bnb: null,
      chains: [
        { chain: "bitcoin", code: "btc", api_key: "YourApikey", callback_url: "https://yourdomain.com/callback", address: null, xpub: "zpub" },
        { chain: "binance", code: "bnb", api_key: "YourApiKey22", callback_url: null, address: null },
        { chain: "ethereum", code: "eth", api_key: "YourApiKey33", callback_url: "", address: "0xabc" },
      ],
    });

    expect(store.id).toBe(1);
    expect(store.chains.map((chain) => chain.code)).toEqual(["btc", "bnb", "eth"]);
    // bnb and eth are exactly the entries Bcon's form rejects as null.
    expect(store.chains.filter((chain) => !chain.callbackUrl).map((chain) => chain.code)).toEqual(["bnb", "eth"]);
    // API key values are never exposed — only whether one exists.
    expect(JSON.stringify(store)).not.toContain("YourApikey");
  });

  it("falls back to the flat BTC/BNB columns for older payloads", () => {
    const store = normalizeBconStore({
      id: 2,
      api_key: "k1",
      api_key_bnb: "k2",
      callback_url: "https://yourdomain.com/callback",
      callback_url_bnb: null,
    });
    expect(store.chains).toHaveLength(2);
    expect(store.chains[0]).toMatchObject({ code: "btc", callbackUrl: "https://yourdomain.com/callback", hasApiKey: true });
    expect(store.chains[1]).toMatchObject({ code: "bnb", callbackUrl: null });
  });

  it("reads every flat per-chain callback column", () => {
    const values = bconStoreCallbackFieldValues({
      callback_url: "https://erobabe.vercel.app/api/bcon/callback",
      callback_url_bnb: "",
      callback_url_eth: "https://erobabe.vercel.app/api/bcon/callback",
      callback_url_trx: null,
    });
    expect(values).toEqual({
      callback_url: "https://erobabe.vercel.app/api/bcon/callback",
      callback_url_bnb: null,
      callback_url_eth: "https://erobabe.vercel.app/api/bcon/callback",
      callback_url_trx: null,
      callback_url_sol: null,
    });
  });
});

describe("bcon address payload", () => {
  it("sends every documented field as a string", () => {
    const payload = bconCreateAddressPayload({
      payment_currency: "USDT",
      origin_amount: "99",
      origin_currency: "USD",
      external_id: "EABC1234",
      chain: "ethereum",
    });
    expect(payload).toEqual({
      payment_currency: "USDT",
      origin_amount: "99",
      origin_currency: "USD",
      external_id: "EABC1234",
      chain: "ethereum",
    });
    expect(Object.values(payload).every((value) => typeof value === "string" && value.length > 0)).toBe(true);
    expect(payload.payment_amount).toBeUndefined();
  });

  it("keeps an explicit payment amount and rejects invalid external ids", () => {
    const payload = bconCreateAddressPayload({
      payment_currency: "USDC",
      origin_amount: "15",
      origin_currency: "USD",
      payment_amount: "15",
      external_id: "test",
      chain: "ethereum",
    });
    expect(payload.payment_amount).toBe("15");
    expect(() =>
      bconCreateAddressPayload({
        payment_currency: "USDT",
        origin_amount: "99",
        origin_currency: "USD",
        external_id: "TOO-LONG-ID",
        chain: "ethereum",
      })
    ).toThrow(/at most 8 characters/);
    expect(() =>
      bconCreateAddressPayload({
        payment_currency: "USDT",
        origin_amount: "99",
        origin_currency: "USD",
        external_id: "",
        chain: "ethereum",
      })
    ).toThrow(/external_id is required/);
    expect(() =>
      bconCreateAddressPayload({
        payment_currency: "",
        origin_amount: "99",
        origin_currency: "USD",
        external_id: "EABC1234",
        chain: "ethereum",
      })
    ).toThrow(/payment_currency must be a non-empty string/);
  });
});

describe("bcon transaction verification", () => {
  it("returns the provider transaction for a known txid", async () => {
    process.env.BCON_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          status: "Ok",
          data: {
            transaction: {
              transaction_id: "0xabc",
              address: "0xB94522D6d928361111c4956E7ed8A48f0aB9969C",
              status: "confirmed",
              sum: "99.000000000000000000",
              currency: { id: 4, name: "USDT", iso_name: "usdt" },
              store: { id: 212, name: "erobabe" },
              created_at: "2026-10-11T00:00:00.000000Z",
            },
          },
        })
      )
    );

    const result = await getBconTransaction("0xabc");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transaction).toMatchObject({
      transactionId: "0xabc",
      address: "0xB94522D6d928361111c4956E7ed8A48f0aB9969C",
      status: "confirmed",
      sum: "99.000000000000000000",
      currency: "usdt",
    });
  });

  it("reports unknown txids and provider failures separately", async () => {
    process.env.BCON_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ status: "Error", message: "not found" }, 404)));
    expect(await getBconTransaction("0xmissing")).toMatchObject({ ok: false, reason: "not_found" });

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ status: "Error" }, 500)));
    const failure = await getBconTransaction("0xabc");
    expect(failure.ok).toBe(false);
    if (failure.ok) return;
    expect(failure.reason).toBe("api_error");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("socket hang up");
      })
    );
    expect(await getBconTransaction("0xabc")).toMatchObject({ ok: false, reason: "api_error" });
  });

  it("never calls the provider without an API key", async () => {
    delete process.env.BCON_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await getBconTransaction("0xabc");
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("bcon diagnostics", () => {
  it("reports missing credentials with a corrective action", async () => {
    delete process.env.BCON_API_KEY;
    const report = await inspectBconSetup("https://erobabe.vercel.app");
    expect(report.configured).toBe(false);
    expect(report.error).toMatch(/BCON_API_KEY/);
    expect(report.callbackUrl).toBe("https://erobabe.vercel.app/api/bcon/callback");
    expect(report.correctiveActions.join(" ")).toContain("BCON_API_KEY");
    expect(report.correctiveActions.join(" ")).toContain("https://erobabe.vercel.app/api/bcon/callback");
    expect(report.unverified.join(" ")).toContain("no store-write endpoint");
  });

  it("flags empty per-chain callback fields returned by Bcon", async () => {
    process.env.BCON_API_KEY = "test-key";
    process.env.BCON_CHAIN = "ethereum";
    process.env.BCON_PAYMENT_CURRENCY = "USDT";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          status: "Ok",
          data: {
            addresses: [
              {
                id: 1,
                name: "erobabe",
                tag: "prod",
                callback_url: "https://erobabe.vercel.app/api/bcon/callback",
                callback_url_bnb: null,
                callback_url_eth: "",
                chains: [
                  { chain: "bitcoin", code: "btc", api_key: "k", callback_url: "https://erobabe.vercel.app/api/bcon/callback" },
                  { chain: "binance", code: "bnb", api_key: null, callback_url: null },
                  { chain: "ethereum", code: "eth", api_key: "k2", callback_url: "" },
                ],
              },
            ],
          },
        })
      )
    );

    const report = await inspectBconSetup("https://erobabe.vercel.app");
    expect(report.configured).toBe(true);
    expect(report.store?.name).toBe("erobabe");
    expect(report.missingCallbackChains.sort()).toEqual(["bnb", "eth"]);
    expect(report.mismatchedCallbackChains).toEqual([]);
    expect(report.correctiveActions.join(" ")).toContain("callback_url.bnb");
    expect(report.correctiveActions.join(" ")).toContain("callback_url.eth");
    // The SOL/TRX chains are never returned by Bcon for this store: unverified, not "ok".
    const sol = report.callbackFields.find((field) => field.code === "sol");
    expect(sol?.reportedByStore).toBe(false);
    expect(report.unverified.join(" ")).toContain("trx");
    // No key material leaks through the report.
    expect(JSON.stringify(report)).not.toContain('"k2"');
  });

  it("flags callback URLs that point somewhere else", async () => {
    process.env.BCON_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          status: "Ok",
          data: {
            addresses: [
              {
                id: 7,
                name: "erobabe",
                callback_url: "https://old-deployment.example.com/api/bcon/callback",
                chains: [{ chain: "bitcoin", code: "btc", api_key: "k", callback_url: "https://old-deployment.example.com/api/bcon/callback" }],
              },
            ],
          },
        })
      )
    );

    const report = await inspectBconSetup("https://erobabe.vercel.app");
    expect(report.mismatchedCallbackChains).toEqual(["btc"]);
    expect(report.correctiveActions.join(" ")).toContain("https://erobabe.vercel.app/api/bcon/callback");
  });

  it("reports an unreachable API instead of a false success", async () => {
    process.env.BCON_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ message: "Unauthorized" }, 401)));
    const report = await inspectBconSetup("https://erobabe.vercel.app");
    expect(report.store).toBeNull();
    expect(report.error).toMatch(/401/);
    expect(report.unverified.join(" ")).toContain("could not be read");
  });

  it("warns when BCON_CALLBACK_URL is configured incorrectly", async () => {
    delete process.env.BCON_API_KEY;
    process.env.BCON_CALLBACK_URL = "erobabe.vercel.app/callback";
    const report = await inspectBconSetup("https://erobabe.vercel.app");
    expect(report.callbackUrl).toBe("https://erobabe.vercel.app/api/bcon/callback");
    expect(report.configWarnings.join(" ")).toContain("BCON_CALLBACK_URL");
  });

  it("probes the callback endpoint and reports the real HTTP status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ status: "ok" }, 200)));
    expect(await probeBconCallbackEndpoint("https://erobabe.vercel.app")).toMatchObject({
      ok: true,
      url: "https://erobabe.vercel.app/api/bcon/callback",
      status: 200,
    });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    expect(await probeBconCallbackEndpoint("https://erobabe.vercel.app")).toMatchObject({ ok: false, status: 500 });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ENOTFOUND");
      })
    );
    const failed = await probeBconCallbackEndpoint("https://erobabe.vercel.app");
    expect(failed.ok).toBe(false);
    expect(failed.error).toMatch(/ENOTFOUND/);
  });
});
