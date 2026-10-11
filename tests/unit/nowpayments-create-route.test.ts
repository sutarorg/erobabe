import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase } from "./helpers/fake-supabase";

/**
 * Route tests for the NOWPayments checkout (`POST /api/nowpayments/create`).
 *
 * Supabase is replaced with an in-memory client and the NOWPayments API with
 * a stubbed `fetch`, so the tests assert the real business rules — ownership,
 * server-side pricing, unsupported assets, slot conflicts, and failure
 * handling — without spending anything.
 */

const state = vi.hoisted(() => ({ auth: null as unknown, service: null as unknown }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.auth,
  createServiceClient: () => state.service,
}));

import { POST } from "@/app/api/nowpayments/create/route";

const CREATE_URL = "https://erobabe.vercel.app/api/nowpayments/create";
const CAMPAIGN_ID = "11111111-1111-1111-8111-111111111111";
const OTHER_CAMPAIGN_ID = "22222222-2222-2222-8222-222222222222";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function providerPayment(overrides: Record<string, unknown> = {}) {
  return {
    payment_id: "5730453421",
    payment_status: "waiting",
    pay_address: "TNPayAddress123",
    price_amount: 99,
    price_currency: "usd",
    pay_amount: 99.5,
    pay_currency: "usdterc20",
    order_id: "INV-test",
    ...overrides,
  };
}

function stubProvider(response: Response | (() => Response | Promise<Response>)) {
  const spy = vi.fn(async (..._args: unknown[]) =>
    typeof response === "function" ? await response() : response.clone()
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

function todayPlus(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().split("T")[0];
}

function seed(options: {
  user?: { id: string } | null;
  profile?: Record<string, unknown> | null;
  campaigns?: Record<string, unknown>[];
  slots?: Record<string, unknown>[];
} = {}) {
  const user = options.user === undefined ? { id: "advertiser-1" } : options.user;
  const fake = createFakeSupabase({
    profiles: options.profile === null ? [] : [options.profile || { id: "advertiser-1", role: "advertiser", status: "active" }],
    campaigns: options.campaigns || [
      {
        id: CAMPAIGN_ID,
        advertiser_id: "advertiser-1",
        slot_id: 1,
        payment_id: null,
        invoice_id: null,
        status: "pending_payment",
        start_date: todayPlus(0),
        end_date: todayPlus(30),
      },
    ],
    ad_slots: options.slots || [{ id: 1, price_cents: 9900 }],
    payments: [],
    invoices: [],
    payment_events: [],
    audit_logs: [],
  });
  state.auth = {
    ...fake.client,
    auth: { getUser: async () => ({ data: { user }, error: null }) },
  };
  state.service = fake.client;
  return fake;
}

function request(body: unknown) {
  return new NextRequest(CREATE_URL, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  } as any);
}

const validBody = {
  campaignIds: [CAMPAIGN_ID],
  slotIds: [1],
  durationMonths: 1,
  paymentCurrency: "USDT",
  chain: "ethereum",
};

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv("NOWPAYMENTS_API_KEY", "test-key");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://erobabe.vercel.app");
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  void errorSpy;
});

describe("POST /api/nowpayments/create", () => {
  it("creates a payment, invoice, and campaign link with server-calculated pricing", async () => {
    const fake = seed();
    const fetchSpy = stubProvider(jsonResponse(providerPayment()));

    const response = await POST(request(validBody));

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.address).toBe("TNPayAddress123");
    expect(json.amount).toBe("99.5");
    expect(json.payCurrency).toBe("usdterc20");
    expect(json.paymentCurrency).toBe("USDT");
    expect(json.network).toBe("Ethereum");
    expect(json.priceCents).toBe(9900);
    expect(json.providerPaymentId).toBe("5730453421");
    expect(json.invoiceNumber).toBeTruthy();

    // Provider request used trusted values, not client input.
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(String(init.body));
    expect(sent.price_amount).toBe(99);
    expect(sent.price_currency).toBe("usd");
    expect(sent.pay_currency).toBe("usdterc20");
    expect(sent.order_id).toBe(json.invoiceNumber);
    expect(sent.ipn_callback_url).toBe("https://erobabe.vercel.app/api/nowpayments/ipn");

    // Local records.
    expect(fake.db.payments).toHaveLength(1);
    const payment = fake.db.payments[0];
    expect(payment.provider).toBe("nowpayments");
    expect(payment.provider_payment_id).toBe("5730453421");
    expect(payment.provider_status).toBe("waiting");
    expect(payment.pay_currency).toBe("usdterc20");
    expect(payment.expected_amount).toBe("99.5");
    expect(payment.amount_cents).toBe(9900);
    expect(payment.status).toBe("awaiting_confirmation");
    expect(fake.db.invoices).toHaveLength(1);
    expect(fake.db.invoices[0].payment_id).toBe(payment.id);
    expect(fake.db.campaigns[0].payment_id).toBe(payment.id);
    expect(fake.db.campaigns[0].invoice_id).toBe(fake.db.invoices[0].id);
    expect(fake.db.payment_events.some((event) => event.event_type === "address_created")).toBe(true);
  });

  it("requires authentication", async () => {
    seed({ user: null });
    stubProvider(jsonResponse(providerPayment()));
    const response = await POST(request(validBody));
    expect(response.status).toBe(401);
  });

  it("requires an active advertiser role", async () => {
    seed({ profile: { id: "advertiser-1", role: "viewer", status: "active" } });
    stubProvider(jsonResponse(providerPayment()));
    const response = await POST(request(validBody));
    expect(response.status).toBe(403);
  });

  it("rejects invalid request bodies", async () => {
    seed();
    stubProvider(jsonResponse(providerPayment()));
    const response = await POST(request({ durationMonths: 99 }));
    expect(response.status).toBe(400);
  });

  it("rejects unsupported asset/network combinations without touching the database", async () => {
    const fake = seed();
    const fetchSpy = stubProvider(jsonResponse(providerPayment()));
    const response = await POST(request({ ...validBody, paymentCurrency: "DOGE", chain: "ethereum" }));
    expect(response.status).toBe(400);
    expect(fake.db.payments).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects campaigns that do not belong to the advertiser", async () => {
    seed({
      campaigns: [
        {
          id: CAMPAIGN_ID,
          advertiser_id: "someone-else",
          slot_id: 1,
          payment_id: null,
          status: "pending_payment",
          start_date: todayPlus(0),
          end_date: todayPlus(30),
        },
      ],
    });
    stubProvider(jsonResponse(providerPayment()));
    const response = await POST(request(validBody));
    expect(response.status).toBe(404);
  });

  it("prevents a campaign from being paid for twice", async () => {
    seed({
      campaigns: [
        {
          id: CAMPAIGN_ID,
          advertiser_id: "advertiser-1",
          slot_id: 1,
          payment_id: "existing-payment",
          status: "pending_payment",
          start_date: todayPlus(0),
          end_date: todayPlus(30),
        },
      ],
    });
    stubProvider(jsonResponse(providerPayment()));
    const response = await POST(request(validBody));
    expect(response.status).toBe(409);
  });

  it("rejects conflicting slot reservations", async () => {
    const fake = seed({
      campaigns: [
        {
          id: CAMPAIGN_ID,
          advertiser_id: "advertiser-1",
          slot_id: 1,
          payment_id: null,
          status: "pending_payment",
          start_date: todayPlus(0),
          end_date: todayPlus(30),
        },
        {
          id: OTHER_CAMPAIGN_ID,
          advertiser_id: "someone-else",
          slot_id: 1,
          payment_id: "other-payment",
          status: "active",
          start_date: todayPlus(0),
          end_date: todayPlus(30),
        },
      ],
    });
    stubProvider(jsonResponse(providerPayment()));
    const response = await POST(request(validBody));
    expect(response.status).toBe(409);
    expect(fake.db.payments).toHaveLength(0);
  });

  it("records provider failures without a payable-looking record", async () => {
    const fake = seed();
    stubProvider(jsonResponse({ message: "pay_currency not available" }, 400));

    const response = await POST(request(validBody));

    expect(response.status).toBe(502);
    expect(fake.db.payments).toHaveLength(1);
    expect(fake.db.payments[0].status).toBe("failed");
    expect(fake.db.payments[0].payment_address).toBeFalsy();
    expect(fake.db.invoices).toHaveLength(0);
    expect(fake.db.campaigns[0].payment_id).toBeNull();
  });

  it("reports missing server configuration instead of calling the provider", async () => {
    vi.stubEnv("NOWPAYMENTS_API_KEY", "");
    const fake = seed();
    const fetchSpy = stubProvider(jsonResponse(providerPayment()));
    const response = await POST(request(validBody));
    expect(response.status).toBe(503);
    expect(fake.db.payments).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
