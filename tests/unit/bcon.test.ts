import { describe, it, expect } from "vitest";
import {
  bconCallbackAmount,
  bconCallbackUrl,
  bconCallbackUrlMap,
  bconChainCode,
  bconMerchantCallbackPayload,
  createBconExternalId,
  mapBconStatus,
  normalizeBconStore,
  parseBconCallback,
} from "@/lib/bcon/client";

describe("bcon client", () => {
  it("maps bcon statuses", () => {
    expect(mapBconStatus("confirmed")).toBe("confirmed");
    expect(mapBconStatus("unconfirmed")).toBe("unconfirmed");
    expect(mapBconStatus("partially_confirmed")).toBe("partially_confirmed");
    expect(mapBconStatus("1")).toBe("partially_confirmed");
    expect(mapBconStatus("2")).toBe("confirmed");
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
  });

  it("builds a merchant-platforms callback_url object of strings", () => {
    const payload = bconMerchantCallbackPayload("https://erobabe.com");
    expect(payload.callback_url.btc).toBe("https://erobabe.com/api/bcon/callback");
    expect(typeof payload.callback_url.btc).toBe("string");
    expect(typeof payload.callback_url.bnb).toBe("string");
    expect(typeof payload.callback_url.eth).toBe("string");
    expect(Object.values(payload.callback_url).every((value) => typeof value === "string" && value.length > 0)).toBe(true);
    // A bare string in callback_url is exactly what Bcon rejects as
    // "The callback_url.btc must be a string".
    expect(typeof payload.callback_url).toBe("object");
    expect(Array.isArray(payload.callback_url)).toBe(false);
  });

  it("maps every supported chain to the same https callback string", () => {
    const map = bconCallbackUrlMap("https://erobabe.com");
    expect(map).toEqual({
      btc: "https://erobabe.com/api/bcon/callback",
      bnb: "https://erobabe.com/api/bcon/callback",
      eth: "https://erobabe.com/api/bcon/callback",
      trx: "https://erobabe.com/api/bcon/callback",
      sol: "https://erobabe.com/api/bcon/callback",
    });
  });

  it("reads the amount from value, amount, or sum", () => {
    expect(bconCallbackAmount({ value: "1537643" })).toBe("1537643");
    expect(bconCallbackAmount({ sum: "0.000005" })).toBe("0.000005");
    expect(bconCallbackAmount({})).toBeUndefined();
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
});
