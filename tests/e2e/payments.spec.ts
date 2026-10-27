import { test, expect } from "@playwright/test";

/** Reachability/access-control checks only; no real payment or AI request. */
test.describe("PayPal advertising public surface", () => {
  test("guest checkout is reachable without an account", async ({ request }) => {
    const res = await request.get("/checkout?slot=1");
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain("Your brand, in the spotlight");
  });

  test("an empty submission is rejected without creating an order", async ({ request }) => {
    const res = await request.post("/api/ads/submit", { multipart: {} });
    expect(res.status()).toBe(400);
  });
});

test.describe("AI metadata suggestion surface", () => {
  test("suggestions require authentication", async ({ request }) => {
    const res = await request.post("/api/metadata/suggest", {
      data: { fileName: "clip.mp4" },
    });
    expect(res.status()).toBe(401);
  });

  test("suggestions reject GET", async ({ request }) => {
    const res = await request.get("/api/metadata/suggest");
    expect(res.status()).toBe(405);
  });
});

test.describe("Retired billing and provider routes", () => {
  test("old crypto billing APIs are gone", async ({ request }) => {
    expect((await request.post("/api/nowpayments/create", { data: {} })).status()).toBe(404);
    expect((await request.get("/api/nowpayments/ipn")).status()).toBe(404);
    expect((await request.get("/api/nowpayments/status")).status()).toBe(404);
    expect((await request.get("/api/admin/nowpayments")).status()).toBe(404);
    expect((await request.post("/api/admin/payments/reconcile", { data: {} })).status()).toBe(404);
  });

  test("Bcon and Groq routes are gone", async ({ request }) => {
    expect((await request.post("/api/bcon/create", { data: {} })).status()).toBe(404);
    expect((await request.get("/api/bcon/callback")).status()).toBe(404);
    expect((await request.post("/api/groq/suggest", { data: {} })).status()).toBe(404);
    expect((await request.get("/api/admin/bcon")).status()).toBe(404);
  });
});
