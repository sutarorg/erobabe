import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, makePayment } from "./helpers/fake-supabase";
import { computeNowpaymentsSignature } from "@/lib/nowpayments/client";

/**
 * Route tests for the public NOWPayments IPN endpoint.
 *
 * Everything the route touches is stubbed at the boundary:
 *  - Supabase (`@/lib/supabase/server`) is replaced with an in-memory client
 *    so we can assert on real rows instead of mocked return values.
 *  - `fetch` is stubbed so we control what NOWPayments' payment API reports.
 * No payment is ever "confirmed" by a fixture alone — the route has to find a
 * matching payment AND a corroborating provider record, and every IPN has to
 * carry a valid HMAC signature.
 */

const state = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => state.client,
}));

import { GET, HEAD, POST } from "@/app/api/nowpayments/ipn/route";

const IPN_URL = "https://erobabe.vercel.app/api/nowpayments/ipn";
const IPN_SECRET = "test-ipn-secret-123";
const PROVIDER_PAYMENT_ID = "5730453421";
const PAY_ADDRESS = "0x72E4CF05e4A6b123623B7443fBF8C83BD14182f1";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function baseIpn(overrides: Record<string, unknown> = {}) {
  return {
    payment_id: PROVIDER_PAYMENT_ID,
    payment_status: "finished",
    pay_address: PAY_ADDRESS,
    price_amount: 99,
    price_currency: "usd",
    pay_amount: 99.5,
    actually_paid: 99.5,
    pay_currency: "usdterc20",
    order_id: "INV-1",
    order_description: "Erobabe advertising slots 1 — 1 month",
    purchase_id: "purchase-1",
    ...overrides,
  };
}

function providerRecord(overrides: Record<string, unknown> = {}) {
  return {
    payment_id: PROVIDER_PAYMENT_ID,
    payment_status: "finished",
    pay_address: PAY_ADDRESS,
    price_amount: 99,
    price_currency: "usd",
    pay_amount: 99.5,
    actually_paid: 99.5,
    pay_currency: "usdterc20",
    order_id: "INV-1",
    ...overrides,
  };
}

/** Stubs fetch and returns the spy so tests can inspect the provider calls. */
function stubProvider(
  response: Response | (() => Response | Promise<Response>),
) {
  const spy = vi.fn(async (..._args: unknown[]) =>
    typeof response === "function" ? await response() : response.clone(),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

function seedPayment(overrides: Record<string, unknown> = {}) {
  const fake = createFakeSupabase({
    payments: [
      makePayment(overrides.payment as Record<string, unknown> | undefined),
    ],
    invoices: [
      { id: "invoice-1", number: "INV-1", status: "pending", paid_at: null },
    ],
    campaigns: [
      {
        id: "campaign-1",
        payment_id: "payment-1",
        creative_id: "creative-1",
        status: "pending_payment",
      },
    ],
    ad_creatives: [{ id: "creative-1", status: "approved" }],
  });
  state.client = fake.client;
  return fake;
}

function signedRequest(
  ipn: Record<string, unknown>,
  sigOverrides: { sig?: string | null; raw?: string } = {},
) {
  const raw = sigOverrides.raw ?? JSON.stringify(ipn);
  const sig =
    sigOverrides.sig === undefined
      ? computeNowpaymentsSignature(JSON.parse(raw), IPN_SECRET)
      : sigOverrides.sig;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (sig !== null) headers["x-nowpayments-sig"] = sig as string;
  return new NextRequest(IPN_URL, {
    method: "POST",
    body: raw,
    headers,
  } as any);
}

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv("NOWPAYMENTS_API_KEY", "test-key");
  vi.stubEnv("NOWPAYMENTS_IPN_SECRET", IPN_SECRET);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/nowpayments/ipn", () => {
  it("answers a connectivity probe with 200 and writes nothing", async () => {
    const fake = seedPayment();
    const fetchSpy = stubProvider(jsonResponse({ message: "OK" }));

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok" });
    expect(fake.db.payment_events).toHaveLength(0);
    expect(fake.db.audit_logs).toHaveLength(0);
    expect(fake.db.payments[0].status).toBe("awaiting_confirmation");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("answers HEAD probes without a body", async () => {
    const response = await HEAD();
    expect(response.status).toBe(200);
  });
});

describe("POST /api/nowpayments/ipn — signature enforcement", () => {
  it("rejects an unsigned IPN and leaves the payment unconfirmed", async () => {
    const fake = seedPayment();
    const fetchSpy = stubProvider(jsonResponse(providerRecord()));

    const response = await POST(signedRequest(baseIpn(), { sig: null }));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ status: "rejected" });
    expect(fake.db.payments[0].status).toBe("awaiting_confirmation");
    expect(fake.db.payment_events).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature and leaves the payment unconfirmed", async () => {
    const fake = seedPayment();
    stubProvider(jsonResponse(providerRecord()));

    const response = await POST(
      signedRequest(baseIpn(), { sig: "ab".repeat(64) }),
    );

    expect(response.status).toBe(401);
    expect(fake.db.payments[0].status).toBe("awaiting_confirmation");
    expect(
      fake.db.payment_events.some((event) => event.event_type === "confirmed"),
    ).toBe(false);
  });

  it("rejects a tampered payload even with the original signature", async () => {
    const fake = seedPayment();
    stubProvider(jsonResponse(providerRecord()));
    const original = baseIpn({ payment_status: "waiting" });
    const sig = computeNowpaymentsSignature(original, IPN_SECRET);
    const tampered = JSON.stringify({
      ...original,
      payment_status: "finished",
    });

    const response = await POST(
      signedRequest(original, { sig, raw: tampered }),
    );

    expect(response.status).toBe(401);
    expect(fake.db.payments[0].status).toBe("awaiting_confirmation");
  });

  it("rejects malformed JSON without touching any payment", async () => {
    const fake = seedPayment();
    stubProvider(jsonResponse(providerRecord()));

    const response = await POST(
      signedRequest(baseIpn(), { sig: "ab".repeat(64), raw: "{not json" }),
    );

    expect(response.status).toBe(401);
    expect(fake.db.payments[0].status).toBe("awaiting_confirmation");
    expect(fake.db.payment_events).toHaveLength(0);
  });

  it("fails closed when the IPN secret is not configured", async () => {
    vi.stubEnv("NOWPAYMENTS_IPN_SECRET", "");
    const fake = seedPayment();
    stubProvider(jsonResponse(providerRecord()));

    const response = await POST(
      signedRequest(baseIpn(), { sig: "ab".repeat(64) }),
    );

    expect(response.status).toBe(503);
    expect(fake.db.payments[0].status).toBe("awaiting_confirmation");
  });
});

describe("POST /api/nowpayments/ipn — correlation and verification", () => {
  it("completes a verified finished payment: invoice paid, campaign activated", async () => {
    const fake = seedPayment();
    stubProvider(jsonResponse(providerRecord()));

    const response = await POST(signedRequest(baseIpn()));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "confirmed",
      paymentId: "payment-1",
    });

    expect(fake.db.payments[0].status).toBe("confirmed");
    expect(fake.db.payments[0].provider_status).toBe("finished");
    expect(fake.db.payments[0].confirmed_at).toBeTruthy();
    expect(fake.db.invoices[0].status).toBe("paid");
    expect(fake.db.invoices[0].paid_at).toBeTruthy();
    expect(fake.db.campaigns[0].status).toBe("active");
    expect(
      fake.db.payment_events.filter(
        (event) => event.event_type === "confirmed",
      ),
    ).toHaveLength(1);
  });

  it("moves campaigns with unapproved creatives to pending_review, not active", async () => {
    const fake = seedPayment();
    fake.db.ad_creatives[0].status = "pending";
    stubProvider(jsonResponse(providerRecord()));

    const response = await POST(signedRequest(baseIpn()));

    expect(response.status).toBe(200);
    expect(fake.db.payments[0].status).toBe("confirmed");
    expect(fake.db.campaigns[0].status).toBe("pending_review");
  });

  it("records but never fulfills intermediate statuses", async () => {
    for (const providerStatus of [
      "waiting",
      "confirming",
      "confirmed",
      "sending",
    ]) {
      const fake = seedPayment();
      const fetchSpy = stubProvider(
        jsonResponse(providerRecord({ payment_status: providerStatus })),
      );

      const response = await POST(
        signedRequest(baseIpn({ payment_status: providerStatus })),
      );

      expect(response.status).toBe(200);
      // The provider's intermediate `confirmed` must not mark anything paid.
      expect(fake.db.payments[0].status).not.toBe("confirmed");
      expect(fake.db.invoices[0].status).toBe("pending");
      expect(fake.db.campaigns[0].status).toBe("pending_payment");
      // Intermediates need no corroboration call.
      expect(fetchSpy).not.toHaveBeenCalled();
    }
    // Spot-check the mapped values.
    const confirming = seedPayment();
    stubProvider(jsonResponse(providerRecord()));
    await POST(signedRequest(baseIpn({ payment_status: "confirming" })));
    expect(confirming.db.payments[0].status).toBe("partially_confirmed");
  });

  it("answers unknown payments without touching known ones", async () => {
    const fake = seedPayment();
    stubProvider(
      jsonResponse(
        providerRecord({ payment_id: "999", order_id: "INV-UNKNOWN" }),
      ),
    );

    const response = await POST(
      signedRequest(baseIpn({ payment_id: "999", order_id: "INV-UNKNOWN" })),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "unknown_payment" });
    expect(fake.db.payments[0].status).toBe("awaiting_confirmation");
    expect(
      fake.db.audit_logs.some(
        (log) => log.action === "nowpayments_ipn_unknown_payment",
      ),
    ).toBe(true);
  });

  it("rejects a mismatched order reference", async () => {
    const fake = seedPayment();
    stubProvider(jsonResponse(providerRecord()));

    const response = await POST(
      signedRequest(baseIpn({ order_id: "INV-SOMEONE-ELSE" })),
    );

    expect(response.status).toBe(400);
    expect(fake.db.payments[0].status).toBe("awaiting_confirmation");
    expect(
      fake.db.payment_events.some((event) => event.event_type === "confirmed"),
    ).toBe(false);
  });

  it("rejects a mismatched pay currency", async () => {
    const fake = seedPayment();
    stubProvider(jsonResponse(providerRecord()));

    const response = await POST(
      signedRequest(baseIpn({ pay_currency: "btc" })),
    );

    expect(response.status).toBe(400);
    expect(fake.db.payments[0].status).toBe("awaiting_confirmation");
  });

  it("rejects a finished claim the provider does not corroborate", async () => {
    const fake = seedPayment();
    stubProvider(
      jsonResponse(providerRecord({ payment_status: "confirming" })),
    );

    const response = await POST(signedRequest(baseIpn()));

    expect(response.status).toBe(503);
    expect(fake.db.payments[0].status).toBe("awaiting_confirmation");
    expect(fake.db.invoices[0].status).toBe("pending");
    expect(
      fake.db.payment_events.some((event) => event.event_type === "confirmed"),
    ).toBe(false);
  });

  it("asks for a retry when NOWPayments is unreachable", async () => {
    const fake = seedPayment();
    stubProvider(jsonResponse({ message: "upstream down" }, 503));

    const response = await POST(signedRequest(baseIpn()));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: "retry_later" });
    expect(fake.db.payments[0].status).toBe("awaiting_confirmation");
  });

  it("records underpaid finished payments for manual review without fulfilling", async () => {
    const fake = seedPayment();
    stubProvider(jsonResponse(providerRecord({ actually_paid: 10 })));

    const response = await POST(signedRequest(baseIpn({ actually_paid: 10 })));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "underpaid" });
    expect(fake.db.payments[0].status).toBe("underpaid");
    expect(fake.db.invoices[0].status).toBe("pending");
    expect(fake.db.campaigns[0].status).toBe("pending_payment");
  });

  it("never activates campaigns on partially_paid", async () => {
    const fake = seedPayment();
    stubProvider(
      jsonResponse(
        providerRecord({ payment_status: "partially_paid", actually_paid: 10 }),
      ),
    );

    const response = await POST(
      signedRequest(
        baseIpn({ payment_status: "partially_paid", actually_paid: 10 }),
      ),
    );

    expect(response.status).toBe(200);
    expect(fake.db.payments[0].status).toBe("underpaid");
    expect(fake.db.invoices[0].status).toBe("pending");
    expect(fake.db.campaigns[0].status).toBe("pending_payment");
  });

  it("applies expired and failed outcomes with invoice/campaign side effects", async () => {
    for (const providerStatus of ["expired", "failed"] as const) {
      const fake = seedPayment();
      stubProvider(
        jsonResponse(providerRecord({ payment_status: providerStatus })),
      );

      const response = await POST(
        signedRequest(baseIpn({ payment_status: providerStatus })),
      );

      expect(response.status).toBe(200);
      expect(fake.db.payments[0].status).toBe(providerStatus);
      expect(fake.db.invoices[0].status).toBe(providerStatus);
      expect(fake.db.campaigns[0].status).toBe("cancelled");
    }
  });

  it("moves a refund after completion to refunded and pauses campaigns", async () => {
    const fake = seedPayment({
      payment: {
        status: "confirmed",
        provider_status: "finished",
        confirmed_at: "2026-01-01T00:00:00Z",
      },
    });
    fake.db.campaigns[0].status = "active";
    fake.db.invoices[0].status = "paid";
    stubProvider(jsonResponse(providerRecord({ payment_status: "refunded" })));

    const response = await POST(
      signedRequest(baseIpn({ payment_status: "refunded" })),
    );

    expect(response.status).toBe(200);
    expect(fake.db.payments[0].status).toBe("refunded");
    expect(fake.db.invoices[0].status).toBe("refunded");
    expect(fake.db.campaigns[0].status).toBe("paused");
  });
});

describe("POST /api/nowpayments/ipn — idempotency", () => {
  it("processes a repeated final IPN without duplicating business actions", async () => {
    const fake = seedPayment();
    stubProvider(jsonResponse(providerRecord()));

    const first = await POST(signedRequest(baseIpn()));
    expect(first.status).toBe(200);
    expect(fake.db.payments[0].status).toBe("confirmed");

    const second = await POST(signedRequest(baseIpn()));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ status: "already_processed" });

    expect(
      fake.db.payment_events.filter(
        (event) => event.event_type === "confirmed",
      ),
    ).toHaveLength(1);
    expect(
      fake.db.invoices.filter((invoice) => invoice.status === "paid"),
    ).toHaveLength(1);
  });

  it("dedupes repeated partially_paid notifications without re-applying side effects", async () => {
    const fake = seedPayment();
    stubProvider(
      jsonResponse(
        providerRecord({ payment_status: "partially_paid", actually_paid: 10 }),
      ),
    );

    const first = await POST(
      signedRequest(
        baseIpn({ payment_status: "partially_paid", actually_paid: 10 }),
      ),
    );
    expect(first.status).toBe(200);
    expect(fake.db.payments[0].status).toBe("underpaid");
    const terminalEvents = fake.db.payment_events.filter(
      (event) => event.event_type === "underpaid",
    );
    expect(terminalEvents).toHaveLength(1);

    const second = await POST(
      signedRequest(
        baseIpn({ payment_status: "partially_paid", actually_paid: 10 }),
      ),
    );
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ status: "already_processed" });
    expect(
      fake.db.payment_events.filter(
        (event) => event.event_type === "underpaid",
      ),
    ).toHaveLength(1);
  });

  it("ignores stale intermediate notifications after completion", async () => {
    const fake = seedPayment();
    stubProvider(jsonResponse(providerRecord()));

    await POST(signedRequest(baseIpn()));
    expect(fake.db.payments[0].status).toBe("confirmed");

    const stale = await POST(
      signedRequest(baseIpn({ payment_status: "confirming" })),
    );
    expect(stale.status).toBe(200);
    expect(fake.db.payments[0].status).toBe("confirmed");
    expect(fake.db.payments[0].provider_status).toBe("finished");
    expect(
      fake.db.payment_events.filter(
        (event) => event.event_type === "confirmed",
      ),
    ).toHaveLength(1);
  });

  it("handles out-of-order intermediate notifications without downgrading", async () => {
    const fake = seedPayment();
    stubProvider(jsonResponse(providerRecord()));

    await POST(signedRequest(baseIpn({ payment_status: "confirming" })));
    expect(fake.db.payments[0].status).toBe("partially_confirmed");

    // A late `waiting` for the same payment must not move it backwards.
    await POST(signedRequest(baseIpn({ payment_status: "waiting" })));
    expect(fake.db.payments[0].status).toBe("partially_confirmed");
  });
});

describe("POST /api/nowpayments/ipn — failure handling", () => {
  it("reports database failures instead of claiming success", async () => {
    seedPayment();
    stubProvider(jsonResponse(providerRecord()));
    state.client = {
      from: () => {
        throw new Error("db down");
      },
    };

    const response = await POST(
      signedRequest(baseIpn({ payment_status: "waiting" })),
    );

    expect(response.status).toBe(500);
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("strict provider evidence", () => {
  it.each([
    { payment_id: "999" },
    { order_id: "wrong-order" },
    { order_id: null },
    { pay_currency: "btc" },
    { pay_currency: null },
    { pay_address: null },
    { price_amount: null },
    { price_currency: "eur" },
    { price_amount: 1 },
    { actually_paid: null },
  ])(
    "never fulfills incomplete/mismatched provider evidence %j",
    async (override) => {
      const fake = seedPayment();
      stubProvider(jsonResponse(providerRecord(override)));
      const response = await POST(signedRequest(baseIpn()));
      expect(response.status).toBe(400);
      expect(fake.db.payments[0].status).not.toBe("confirmed");
      expect(fake.db.invoices[0].status).toBe("pending");
      expect(fake.db.campaigns[0].status).toBe("pending_payment");
    },
  );
});

describe("terminal snapshots never bypass transactional settlement", () => {
  it.each(["failed", "expired", "refunded"])(
    "does not strand invoices when a finished IPN disagrees with provider %s",
    async (status) => {
      const fake = seedPayment();
      stubProvider(jsonResponse(providerRecord({ payment_status: status })));
      const response = await POST(signedRequest(baseIpn()));
      expect(response.status).toBe(503);
      expect(fake.db.payments[0].status).toBe("awaiting_confirmation");
      expect(fake.db.invoices[0].status).toBe("pending");
      expect(fake.db.campaigns[0].status).toBe("pending_payment");
      expect(
        (await POST(signedRequest(baseIpn({ payment_status: status })))).status,
      ).toBe(200);
      expect(fake.db.payments[0].status).toBe(status);
      expect(fake.db.invoices[0].status).toBe(status);
    },
  );
  it.each([
    ["98.9", "underpaid"],
    ["100.1", "overpaid"],
  ])(
    "does not silently forgive a near-miss %s amount",
    async (amount, status) => {
      const fake = seedPayment();
      stubProvider(jsonResponse(providerRecord({ actually_paid: amount })));
      expect(
        (await POST(signedRequest(baseIpn({ actually_paid: amount })))).status,
      ).toBe(200);
      expect(fake.db.payments[0].status).toBe(status);
      expect(fake.db.invoices[0].status).toBe("pending");
      expect(fake.db.campaigns[0].status).toBe("pending_payment");
    },
  );
});
