import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, makePayment } from "./helpers/fake-supabase";
const state = vi.hoisted(() => ({ auth: null as any, service: null as any }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.auth,
  createServiceClient: () => state.service,
}));
import { GET } from "@/app/api/nowpayments/status/route";
const id = "11111111-1111-4111-8111-111111111111";
function setup(overrides: Record<string, unknown> = {}) {
  const fake = createFakeSupabase({
    payments: [makePayment({ id, created_at: "2020-01-01" })],
    profiles: [{ id: "advertiser-1", role: "advertiser", status: "active" }],
    invoices: [{ payment_id: id, number: "INV-1", status: "pending" }],
    campaigns: [{ id: "c", payment_id: id, status: "pending_payment" }],
  });
  state.service = fake.client;
  state.auth = {
    ...fake.client,
    auth: { getUser: async () => ({ data: { user: { id: "advertiser-1" } } }) },
  };
  vi.stubEnv("NOWPAYMENTS_API_KEY", "test-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        payment_id: "5730453421",
        payment_status: "finished",
        order_id: "INV-1",
        pay_currency: "usdterc20",
        pay_address: fake.db.payments[0].payment_address,
        price_amount: 99,
        price_currency: "usd",
        pay_amount: "99.5",
        actually_paid: "99.5",
        ...overrides,
      }),
    ),
  );
  return fake;
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("polling uses the same strict lifecycle as IPN", () => {
  it.each([
    { order_id: "wrong" },
    { pay_currency: "btc" },
    { pay_address: "wrong" },
    { actually_paid: null },
    { price_currency: "eur" },
  ])("does not confirm mismatched evidence %j", async (override) => {
    const fake = setup(override);
    const response = await GET(
      new NextRequest(
        `https://example.com/api/nowpayments/status?paymentId=${id}`,
      ),
    );
    expect(response.status).toBe(200);
    expect(fake.db.payments[0].status).toBe("awaiting_confirmation");
    expect(fake.db.invoices[0].status).toBe("pending");
  });
  it("confirms verified completion and invoice/campaign side effects together", async () => {
    const fake = setup();
    await GET(
      new NextRequest(
        `https://example.com/api/nowpayments/status?paymentId=${id}`,
      ),
    );
    expect(fake.db.payments[0].status).toBe("confirmed");
    expect(fake.db.invoices[0].status).toBe("paid");
    expect(fake.db.campaigns[0].status).toBe("pending_review");
  });
  it("denies suspended owners", async () => {
    const fake = setup();
    fake.db.profiles[0].status = "suspended";
    const response = await GET(
      new NextRequest(
        `https://example.com/api/nowpayments/status?paymentId=${id}`,
      ),
    );
    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
});
