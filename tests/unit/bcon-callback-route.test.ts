import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, makePayment } from "./helpers/fake-supabase";

/**
 * End-to-end tests for the public Bcon callback endpoint.
 *
 * Everything the route touches is stubbed at the boundary:
 *  - Supabase (``@/lib/supabase/server``) is replaced with an in-memory client
 *    so we can assert on real rows instead of mocked return values.
 *  - `fetch` is stubbed so we control what Bcon's transaction API reports.
 * No payment is ever "confirmed" by a fixture alone — the route has to find a
 * matching payment AND a confirmed provider transaction.
 */

const state = vi.hoisted(() => ({ client: null as any }));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => state.client,
}));

import { GET, HEAD, POST } from "@/app/api/bcon/callback/route";

const CALLBACK_URL = "https://erobabe.vercel.app/api/bcon/callback";
const PAYMENT_ADDRESS = "0x72E4CF05e4A6b123623B7443fBF8C83BD14182f1";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function providerTransaction(overrides: Record<string, unknown> = {}) {
  return {
    status: "Ok",
    data: {
      transaction: {
        transaction_id: "0xabc",
        address: PAYMENT_ADDRESS,
        status: "confirmed",
        sum: "99.000000000000000000",
        currency: { id: 4, name: "USDT", iso_name: "usdt" },
        store: { id: 212, name: "erobabe" },
        ...overrides,
      },
    },
  };
}

/** Stubs fetch and returns the spy so tests can inspect the provider calls. */
function stubProvider(response: Response | (() => Response | Promise<Response>)) {
  const spy = vi.fn(async (..._args: unknown[]) =>
    typeof response === "function" ? await response() : response.clone()
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

function seedPayment(overrides: Record<string, any> = {}) {
  const fake = createFakeSupabase({
    payments: [makePayment(overrides.payment)],
    invoices: [{ id: "invoice-1", number: "INV-1", status: "pending", paid_at: null }],
    campaigns: [{ id: "campaign-1", payment_id: "payment-1", creative_id: "creative-1", status: "pending_payment" }],
    ad_creatives: [{ id: "creative-1", status: "approved" }],
  });
  state.client = fake.client;
  return fake;
}

function request(url: string, init?: RequestInit) {
  return new NextRequest(url, init as any);
}

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv("BCON_API_KEY", "test-key");
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/bcon/callback", () => {
  it("answers a parameter-less connectivity probe with 200 and writes nothing", async () => {
    const fake = seedPayment();
    const fetchSpy = stubProvider(jsonResponse({ status: "Ok" }));

    const response = await GET(request(CALLBACK_URL));

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

  it("rejects an incomplete notification that has no receiving address", async () => {
    const fake = seedPayment();
    stubProvider(jsonResponse(providerTransaction()));

    const response = await GET(request(`${CALLBACK_URL}?external_id=EABC1234&txid=0xabc&status=2`));

    expect(response.status).toBe(400);
    expect(fake.db.payments[0].status).toBe("awaiting_confirmation");
    expect(fake.db.payment_events.some((event) => event.event_type === "confirmed")).toBe(false);
  });

  it("rejects a notification for a payment it does not know", async () => {
    const fake = seedPayment();
    stubProvider(jsonResponse(providerTransaction()));

    const response = await GET(
      request(`${CALLBACK_URL}?external_id=NOPE1234&addr=${PAYMENT_ADDRESS}&txid=0xabc&status=2`)
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "unknown_payment" });
    expect(fake.db.payments[0].status).toBe("awaiting_confirmation");
    expect(fake.db.audit_logs.some((log) => log.action === "bcon_callback_unknown_payment")).toBe(true);
  });

  it("never stores or logs the shared secret from the callback URL", async () => {
    const fake = seedPayment();
    stubProvider(jsonResponse(providerTransaction()));

    await GET(
      request(`${CALLBACK_URL}?external_id=NOPE1234&addr=0xdeadbeef&txid=0xabc&status=2&secret=super-secret&junk=${"z".repeat(500)}`)
    );

    const stored = JSON.stringify(fake.db.audit_logs);
    expect(stored).not.toContain("super-secret");
    expect(stored).not.toContain("secret");
    expect(stored).not.toContain("zzzz");
    const logged = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join(" ");
    expect(logged).not.toContain("super-secret");
  });

  it("records a partially confirmed payment without marking it paid", async () => {
    const fake = seedPayment();
    stubProvider(jsonResponse(providerTransaction({ status: "partially_confirmed" })));

    const response = await GET(
      request(`${CALLBACK_URL}?external_id=EABC1234&addr=${PAYMENT_ADDRESS}&txid=0xabc&value=99&status=1`)
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "partially_confirmed" });
    expect(fake.db.payments[0].status).toBe("partially_confirmed");
    expect(fake.db.payments[0].confirmed_at).toBeNull();
    expect(fake.db.invoices[0].status).toBe("pending");
  });

  it("confirms a payment only when Bcon's own transaction record is confirmed", async () => {
    const fake = seedPayment();
    const fetchSpy = stubProvider(jsonResponse(providerTransaction()));

    const response = await GET(
      request(`${CALLBACK_URL}?external_id=EABC1234&addr=${PAYMENT_ADDRESS}&txid=0xabc&value=99&status=2`)
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "confirmed", paymentId: "payment-1" });
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes("/api/v1/transactions/0xabc"))).toBe(true);

    const payment = fake.db.payments[0];
    expect(payment.status).toBe("confirmed");
    expect(payment.transaction_id).toBe("0xabc");
    expect(payment.confirmed_at).toBeTruthy();
    expect(fake.db.invoices[0].status).toBe("paid");
    expect(fake.db.campaigns[0].status).toBe("active");
    expect(fake.db.payment_events.filter((event) => event.event_type === "confirmed")).toHaveLength(1);
    expect(fake.db.audit_logs.some((log) => log.action === "payment_confirmed")).toBe(true);
    // The verified amounts are recorded for later reconciliation.
    expect(payment.bcon_response).toMatchObject({ provider_status: "confirmed", amount_verified: true });
  });

  it("is idempotent — a repeated callback cannot confirm twice", async () => {
    const fake = seedPayment();
    stubProvider(jsonResponse(providerTransaction()));
    const url = `${CALLBACK_URL}?external_id=EABC1234&addr=${PAYMENT_ADDRESS}&txid=0xabc&value=99&status=2`;

    const first = await GET(request(url));
    const second = await GET(request(url));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ status: "already_processed" });
    expect(fake.db.payment_events.filter((event) => event.event_type === "confirmed")).toHaveLength(1);
    expect(fake.db.payments.filter((payment) => payment.status === "confirmed")).toHaveLength(1);
  });

  it("does not confirm when Bcon reports the transaction as unconfirmed", async () => {
    const fake = seedPayment();
    // Callback claims status=2, provider still says unconfirmed.
    stubProvider(jsonResponse(providerTransaction({ status: "unconfirmed" })));

    const response = await GET(
      request(`${CALLBACK_URL}?external_id=EABC1234&addr=${PAYMENT_ADDRESS}&txid=0xabc&value=99&status=2`)
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "unconfirmed" });
    expect(fake.db.payments[0].status).toBe("awaiting_confirmation");
    expect(fake.db.payments[0].confirmed_at).toBeNull();
  });

  it("does not confirm a txid Bcon has no record of", async () => {
    const fake = seedPayment();
    stubProvider(jsonResponse({ status: "Error", message: "Not found" }, 404));

    const response = await GET(
      request(`${CALLBACK_URL}?external_id=EABC1234&addr=${PAYMENT_ADDRESS}&txid=0xdeadbeef&value=99&status=2`)
    );

    expect(response.status).toBe(400);
    expect(fake.db.payments[0].status).toBe("awaiting_confirmation");
    expect(fake.db.audit_logs.some((log) => log.action === "bcon_callback_transaction_unverified")).toBe(true);
  });

  it("does not confirm when Bcon's transaction record points at another address", async () => {
    const fake = seedPayment();
    stubProvider(jsonResponse(providerTransaction({ address: "0x0000000000000000000000000000000000000000" })));

    const response = await GET(
      request(`${CALLBACK_URL}?external_id=EABC1234&addr=${PAYMENT_ADDRESS}&txid=0xabc&value=99&status=2`)
    );

    expect(response.status).toBe(400);
    expect(fake.db.payments[0].status).toBe("awaiting_confirmation");
    expect(fake.db.audit_logs.some((log) => log.action === "bcon_callback_transaction_address_mismatch")).toBe(true);
  });

  it("does not confirm when the callback address belongs to another payment", async () => {
    const fake = seedPayment();
    stubProvider(jsonResponse(providerTransaction()));

    const response = await GET(
      request(`${CALLBACK_URL}?external_id=EABC1234&addr=0x9999999999999999999999999999999999999999&txid=0xabc&status=2`)
    );

    expect(response.status).toBe(400);
    expect(fake.db.payments[0].status).toBe("awaiting_confirmation");
    expect(fake.db.audit_logs.some((log) => log.action === "bcon_callback_address_mismatch")).toBe(true);
  });

  it("records an underpaid payment instead of confirming it", async () => {
    const fake = seedPayment();
    stubProvider(jsonResponse(providerTransaction({ sum: "1.000000000000000000" })));

    const response = await GET(
      request(`${CALLBACK_URL}?external_id=EABC1234&addr=${PAYMENT_ADDRESS}&txid=0xabc&value=1&status=2`)
    );

    // The notification is accepted and recorded (no retry would change the
    // amount) but the payment is never marked paid.
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "underpaid" });
    expect(fake.db.payments[0].status).toBe("underpaid");
    expect(fake.db.payments[0].confirmed_at).toBeNull();
    expect(fake.db.payment_events.some((event) => event.event_type === "amount_mismatch")).toBe(true);
    expect(fake.db.audit_logs.some((log) => log.action === "bcon_callback_underpaid")).toBe(true);
  });

  it("does not confirm when no amount can be verified", async () => {
    const fake = seedPayment();
    // Provider omits the sum and the callback carries no amount either.
    stubProvider(jsonResponse(providerTransaction({ sum: null })));

    const response = await GET(
      request(`${CALLBACK_URL}?external_id=EABC1234&addr=${PAYMENT_ADDRESS}&txid=0xabc&status=2`)
    );

    expect(response.status).toBe(400);
    expect(fake.db.payments[0].status).toBe("awaiting_confirmation");
    expect(fake.db.payment_events.some((event) => event.event_type === "amount_unverified")).toBe(true);
  });

  it("asks the caller to retry when Bcon's transaction API fails", async () => {
    const fake = seedPayment();
    stubProvider(jsonResponse({ status: "Error" }, 500));

    const response = await GET(
      request(`${CALLBACK_URL}?external_id=EABC1234&addr=${PAYMENT_ADDRESS}&txid=0xabc&value=99&status=2`)
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: "retry_later" });
    expect(fake.db.payments[0].status).toBe("awaiting_confirmation");
  });

  it("never leaks internal error details", async () => {
    state.client = {
      from() {
        throw new Error("postgres://admin:hunter2@db.internal:5432 failed");
      },
    };

    const response = await GET(
      request(`${CALLBACK_URL}?external_id=EABC1234&addr=${PAYMENT_ADDRESS}&txid=0xabc&status=2`)
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "Internal error" });
    expect(JSON.stringify(body)).not.toContain("hunter2");

    const logged = errorSpy.mock.calls.flat().join(" ");
    expect(logged).not.toContain("hunter2");
    expect(logged).toContain("<redacted>");
  });
});

describe("POST /api/bcon/callback", () => {
  it("accepts a JSON body callback", async () => {
    const fake = seedPayment();
    const fetchSpy = stubProvider(jsonResponse(providerTransaction()));

    const response = await POST(
      request(CALLBACK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          external_id: "EABC1234",
          addr: PAYMENT_ADDRESS,
          txid: "0xabc",
          value: "99",
          status: "2",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "confirmed" });
    expect(fetchSpy).toHaveBeenCalled();
    expect(fake.db.payments[0].status).toBe("confirmed");
  });

  it("accepts a form-encoded body callback", async () => {
    const fake = seedPayment();
    stubProvider(jsonResponse(providerTransaction({ status: "partially_confirmed" })));

    const response = await POST(
      request(CALLBACK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          external_id: "EABC1234",
          addr: PAYMENT_ADDRESS,
          txid: "0xabc",
          status: "1",
        }).toString(),
      })
    );

    expect(response.status).toBe(200);
    expect(fake.db.payments[0].status).toBe("partially_confirmed");
  });

  it("treats an empty POST as a connectivity probe", async () => {
    const fake = seedPayment();
    const fetchSpy = stubProvider(jsonResponse({ status: "Ok" }));

    const response = await POST(request(CALLBACK_URL, { method: "POST", body: "" }));

    expect(response.status).toBe(200);
    expect(fake.db.payment_events).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ignores malformed JSON bodies instead of crashing", async () => {
    const fake = seedPayment();
    const fetchSpy = stubProvider(jsonResponse({ status: "Ok" }));

    const response = await POST(
      request(CALLBACK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok" });
    expect(fake.db.payment_events).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
