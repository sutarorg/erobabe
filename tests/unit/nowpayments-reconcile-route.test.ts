// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, makePayment } from "./helpers/fake-supabase";
const state = vi.hoisted(() => ({ auth: null as any, service: null as any }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.auth,
  createServiceClient: () => state.service,
}));
import { POST } from "@/app/api/admin/payments/reconcile/route";
const id = "11111111-1111-4111-8111-111111111111";
const admin = "22222222-2222-4222-8222-222222222222";
const providerId = "5730453421";
const address = "0xFixtureAddress";
const body = { paymentId: id, providerPaymentId: providerId };
function request(value: unknown = body, contentType = "application/json") {
  return new Request("https://example.com/api/admin/payments/reconcile", {
    method: "POST",
    headers: { "content-type": contentType },
    body: JSON.stringify(value),
  });
}
function record(overrides: Record<string, unknown> = {}) {
  return {
    payment_id: providerId,
    payment_status: "finished",
    order_id: "INV-1",
    pay_currency: "usdterc20",
    pay_address: address,
    price_amount: 99,
    price_currency: "usd",
    pay_amount: "99.5",
    actually_paid: "99.5",
    ...overrides,
  };
}
function setup(overrides: Record<string, unknown> = {}) {
  const fake = createFakeSupabase({
    profiles: [{ id: admin, role: "admin", status: "active" }],
    payments: [
      makePayment({
        id,
        provider_payment_id: null,
        payment_address: null,
        expected_amount: null,
        status: "pending",
        ...overrides,
      }),
    ],
    invoices: [{ payment_id: id, number: "INV-1", status: "pending" }],
    campaigns: [{ id: "campaign", payment_id: id, status: "pending_payment" }],
  });
  state.service = fake.client;
  state.auth = {
    ...fake.client,
    auth: { getUser: async () => ({ data: { user: { id: admin } } }) },
  };
  vi.stubEnv("NOWPAYMENTS_API_KEY", "fixture-key-not-a-secret");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(record())),
  );
  return fake;
}
function provider(overrides: Record<string, unknown>) {
  vi.mocked(fetch).mockImplementation(async () =>
    Response.json(record(overrides)),
  );
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("admin recovery uses real authorization, quote validation and shared verifier (mock provider/DB boundary)", () => {
  it.each(["anonymous", "advertiser", "suspended"])(
    "denies %s before provider access",
    async (role) => {
      const fake = setup();
      if (role === "anonymous")
        state.auth.auth.getUser = async () => ({ data: { user: null } });
      if (role === "advertiser") fake.db.profiles[0].role = role;
      if (role === "suspended") fake.db.profiles[0].status = role;
      expect((await POST(request())).status).toBe(
        role === "anonymous" ? 401 : 403,
      );
      expect(fetch).not.toHaveBeenCalled();
      expect(fake.db.payments[0].provider_payment_id).toBeNull();
    },
  );
  it.each([
    { ...body, verified: true },
    { ...body, status: "confirmed" },
    { ...body, providerPaymentId: "../123" },
    { ...body, providerPaymentId: "1".repeat(41) },
    { ...body, paymentId: "not-a-uuid" },
  ])("rejects browser authority/malformed references %j", async (input) => {
    setup();
    expect((await POST(request(input))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects oversized, malformed and non-JSON bodies before provider access", async () => {
    setup();
    expect((await POST(request({ extra: "a".repeat(1100) }))).status).toBe(413);
    expect((await POST(request(body, "text/plain"))).status).toBe(415);
    expect(
      (
        await POST(
          new Request("https://example.com", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{",
          }),
        )
      ).status,
    ).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("returns 404 without a provider call for a nonexistent payment", async () => {
    const fake = setup();
    fake.db.payments.length = 0;
    expect((await POST(request())).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    { payment_id: "123" },
    { order_id: "other-order" },
    { pay_currency: "btc" },
    { price_currency: "eur" },
    { price_amount: "99.004" },
    { price_amount: "NaN" },
    { pay_address: " " },
    { pay_address: "a".repeat(513) },
    { pay_amount: "0" },
    { pay_amount: "-1" },
    { pay_amount: "NaN" },
    { pay_amount: "Infinity" },
    { pay_amount: "1e2" },
    { pay_amount: "0.0000000000000000001" },
  ])(
    "does not irreversibly bind invalid provider evidence %j",
    async (remote) => {
      const fake = setup();
      provider(remote);
      expect((await POST(request())).status).toBe(409);
      expect(fake.db.payments[0]).toMatchObject({
        provider_payment_id: null,
        status: "pending",
        expected_amount: null,
      });
      expect(fake.db.invoices[0].status).toBe("pending");
      expect(fake.db.payment_events).toHaveLength(0);
    },
  );
  it("preserves an existing identity rather than rebinding it", async () => {
    const fake = setup({
      provider_payment_id: "456",
      status: "awaiting_confirmation",
      payment_address: address,
      expected_amount: "99.5",
    });
    expect((await POST(request())).status).toBe(409);
    expect(fake.db.payments[0].provider_payment_id).toBe("456");
    expect(fake.db.invoices[0].status).toBe("pending");
  });
  it.each([
    { stored: { invoice_number: null }, remote: { order_id: null } },
    { stored: { pay_currency: null }, remote: { pay_currency: "" } },
  ])(
    "does not treat missing local and remote identity as a match: %j",
    async ({ stored, remote }) => {
      const fake = setup(stored);
      provider(remote);
      expect((await POST(request())).status).toBe(409);
      expect(fake.db.payments[0].provider_payment_id).toBeNull();
    },
  );
  it("does not attach a NOWPayments quote to another provider", async () => {
    const fake = setup({ provider: "bcon" });
    expect((await POST(request())).status).toBe(409);
    expect(fake.db.payments[0].provider_payment_id).toBeNull();
  });
  it("preserves references on provider failure and does not expose provider errors", async () => {
    const fake = setup();
    vi.mocked(fetch).mockResolvedValue(
      Response.json(
        { message: "private upstream diagnostic" },
        { status: 503 },
      ),
    );
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain(
      "private upstream",
    );
    expect(fake.db.payments[0].provider_payment_id).toBeNull();
  });
  it("recovers, settles, audits the actor, and safely repeats the same reference", async () => {
    const fake = setup();
    expect(await (await POST(request())).json()).toEqual({
      status: "confirmed",
      verified: true,
    });
    expect(fake.db.payments[0]).toMatchObject({
      status: "confirmed",
      provider_payment_id: providerId,
      expected_amount: "99.5",
    });
    expect(fake.db.invoices[0].status).toBe("paid");
    expect(fake.db.campaigns[0].status).toBe("pending_review");
    expect(fake.db.audit_logs).toContainEqual(
      expect.objectContaining({
        actor_id: admin,
        action: "provider_identity_recovered",
        target_id: id,
      }),
    );
    expect((await POST(request())).status).toBe(200);
    expect(
      fake.db.payment_events.filter(
        (e) => e.event_type === "provider_identity_recovered",
      ),
    ).toHaveLength(1);
    expect(
      fake.db.payment_events.filter((e) => e.event_type === "confirmed"),
    ).toHaveLength(1);
  });
  it("binds a valid waiting quote but never fulfills it", async () => {
    const fake = setup();
    provider({ payment_status: "waiting" });
    expect(await (await POST(request())).json()).toEqual({
      status: "awaiting_confirmation",
      verified: false,
    });
    expect(fake.db.invoices[0].status).toBe("pending");
    expect(fake.db.campaigns[0].status).toBe("pending_payment");
  });
  it.each([null, "98.9", "100.1"])(
    "does not fulfill missing/near-miss actually_paid=%s",
    async (amount) => {
      const fake = setup();
      provider({ actually_paid: amount });
      const response = await POST(request());
      expect(response.status).toBe(amount === null ? 409 : 200);
      expect((await response.json()).verified).toBe(false);
      expect(fake.db.payments[0].status).not.toBe("confirmed");
      expect(fake.db.invoices[0].status).toBe("pending");
      expect(fake.db.campaigns[0].status).toBe("pending_payment");
    },
  );
  it("keeps recovered identity retryable after settlement persistence fails", async () => {
    const fake = setup();
    const rpc = fake.client.rpc;
    const spy = vi
      .spyOn(fake.client, "rpc")
      .mockImplementation(async (name, args) =>
        name === "settle_nowpayment"
          ? { error: new Error("fixture storage failure") }
          : rpc(name, args),
      );
    expect((await POST(request())).status).toBe(500);
    expect(fake.db.payments[0]).toMatchObject({
      provider_payment_id: providerId,
      status: "awaiting_confirmation",
    });
    expect(fake.db.invoices[0].status).toBe("pending");
    spy.mockRestore();
    expect((await POST(request())).status).toBe(200);
    expect(fake.db.invoices[0].status).toBe("paid");
    expect(
      fake.db.payment_events.filter(
        (e) => e.event_type === "provider_identity_recovered",
      ),
    ).toHaveLength(1);
  });
  it("returns a retry on provider snapshot drift, then settles every side effect together", async () => {
    const fake = setup();
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json(record()))
      .mockResolvedValueOnce(
        Response.json(record({ payment_status: "failed" })),
      );
    expect((await POST(request())).status).toBe(503);
    expect(fake.db.payments[0].status).toBe("awaiting_confirmation");
    expect(fake.db.invoices[0].status).toBe("pending");
    provider({ payment_status: "failed" });
    expect((await POST(request())).status).toBe(200);
    expect(fake.db.payments[0].status).toBe("failed");
    expect(fake.db.invoices[0].status).toBe("failed");
    expect(fake.db.campaigns[0].status).toBe("cancelled");
  });
  it("can reconcile a provider refund without reviving campaigns", async () => {
    const fake = setup();
    await POST(request());
    provider({ payment_status: "refunded" });
    expect((await POST(request())).status).toBe(200);
    expect(fake.db.payments[0].status).toBe("refunded");
    expect(fake.db.invoices[0].status).toBe("refunded");
    expect(fake.db.campaigns[0].status).toBe("paused");
  });
});
