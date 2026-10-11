import { test, expect } from "@playwright/test";

/**
 * Public-surface tests for the NOWPayments and Gemini routes.
 *
 * These assert reachability and access control only — no real payment, no AI
 * request, no credentials required:
 *  - the IPN endpoint answers probes but rejects unsigned notifications;
 *  - checkout, status, and suggestion endpoints require authentication;
 *  - the retired Bcon/Groq routes are gone.
 */
test.describe("NOWPayments public surface", () => {
  test("IPN endpoint answers a parameter-less probe", async ({ request }) => {
    const res = await request.get("/api/nowpayments/ipn");
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ok");
  });

  test("unsigned IPN is rejected without confirming anything", async ({ request }) => {
    const res = await request.post("/api/nowpayments/ipn", {
      data: { payment_id: "123", payment_status: "finished" },
    });
    // 401 with the secret configured, 503 without it — either way, rejected.
    expect([401, 503]).toContain(res.status());
    const json = await res.json();
    expect(json.status).toBe("rejected");
  });

  test("tampered IPN signature is rejected", async ({ request }) => {
    const res = await request.post("/api/nowpayments/ipn", {
      headers: { "x-nowpayments-sig": "ab".repeat(64) },
      data: { payment_id: "123", payment_status: "finished" },
    });
    expect([401, 503]).toContain(res.status());
  });

  test("checkout requires authentication", async ({ request }) => {
    const res = await request.post("/api/nowpayments/create", {
      data: { campaignIds: ["11111111-1111-1111-8111-111111111111"] },
    });
    expect(res.status()).toBe(401);
  });

  test("payment status requires authentication", async ({ request }) => {
    const res = await request.get("/api/nowpayments/status?paymentId=11111111-1111-1111-8111-111111111111");
    expect(res.status()).toBe(401);
  });
});

test.describe("Gemini suggestion surface", () => {
  test("suggestions require authentication", async ({ request }) => {
    const res = await request.post("/api/gemini/suggest", {
      data: { fileName: "clip.mp4" },
    });
    expect(res.status()).toBe(401);
  });

  test("suggestions reject GET", async ({ request }) => {
    const res = await request.get("/api/gemini/suggest");
    expect(res.status()).toBe(405);
  });
});

test.describe("Retired provider routes", () => {
  test("Bcon and Groq routes are gone", async ({ request }) => {
    expect((await request.post("/api/bcon/create", { data: {} })).status()).toBe(404);
    expect((await request.get("/api/bcon/callback")).status()).toBe(404);
    expect((await request.post("/api/groq/suggest", { data: {} })).status()).toBe(404);
    expect((await request.get("/api/admin/bcon")).status()).toBe(404);
  });
});
