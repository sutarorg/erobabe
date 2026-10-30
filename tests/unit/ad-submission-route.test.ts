// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  limitRequest: vi.fn(),
  service: null as any,
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => state.service,
}));
vi.mock("@/lib/http/safety", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/http/safety")>();
  return { ...actual, limitRequest: state.limitRequest };
});

import { POST } from "@/app/api/ads/submit/route";

function png(width: number, height: number) {
  const bytes = Buffer.alloc(24);
  bytes.write("89504e470d0a1a0a", 0, "hex");
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function gif(width: number, height: number) {
  const bytes = Buffer.alloc(16);
  bytes.write("GIF89a", 0, "ascii");
  bytes.writeUInt16LE(width, 6);
  bytes.writeUInt16LE(height, 8);
  return bytes;
}

function requestWith(
  width = 1200,
  height = 675,
  focus: { x?: string; y?: string; zoom?: string } = {},
  bytes: Buffer = png(width, height),
  type = "image/png",
) {
  const form = new FormData();
  form.set("slotId", "1");
  form.set("durationMonths", "1");
  form.set("adName", "Summer launch");
  form.set("contactName", "Alex Advertiser");
  form.set("companyName", "Example Brand");
  form.set("email", "alex@example.com");
  form.set("aboutAdvertiser", "An independent retailer promoting a seasonal offer.");
  form.set("destinationUrl", "https://example.com/offer");
  form.set("paypalTransactionId", "PAYPAL-123");
  form.set("paymentConfirmed", "true");
  form.set("amountCents", "1"); // Client-supplied pricing is never accepted.
  if (focus.x !== undefined) form.set("focusX", focus.x);
  if (focus.y !== undefined) form.set("focusY", focus.y);
  if (focus.zoom !== undefined) form.set("focusZoom", focus.zoom);
  form.set("creative", new File([new Uint8Array(bytes)], "banner", { type }));
  return new Request("https://example.com/api/ads/submit", { method: "POST", body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.limitRequest.mockResolvedValue("visitor-hash");
  state.upload.mockResolvedValue({ error: null });
  state.remove.mockResolvedValue({ error: null });
  state.rpc.mockResolvedValue({ data: "88888888-8888-4888-8888-888888888888", error: null });
  state.service = {
    storage: {
      from: () => ({
        upload: state.upload,
        remove: state.remove,
        getPublicUrl: () => ({ data: { publicUrl: "https://cdn.example.com/orders/banner.png" } }),
      }),
    },
    rpc: state.rpc,
  };
});

describe("guest ad submission route", () => {
  it("validates and uploads the banner, then creates an in-review order through the priced RPC", async () => {
    const response = await POST(requestWith());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ orderId: "88888888-8888-4888-8888-888888888888", status: "in_review" });
    expect(state.upload).toHaveBeenCalledOnce();
    expect(state.upload.mock.calls[0]?.[0]).toMatch(/^orders\/.+\.png$/);

    const rpcName = state.rpc.mock.calls[0]?.[0];
    const params = state.rpc.mock.calls[0]?.[1];
    expect(rpcName).toBe("submit_ad_order");
    expect(params).toMatchObject({
      p_slot_id: 1,
      p_duration_months: 1,
      p_email: "alex@example.com",
      p_file_type: "image/png",
      p_dimensions: "1200x675",
      p_paypal_transaction_id: "PAYPAL-123",
    });
    expect(params).not.toHaveProperty("p_amount_cents");
    expect(params).not.toHaveProperty("p_status");
    expect(params).not.toHaveProperty("p_payment_status");
  });

  it("does not require the legacy client flag (the real checkout never sends it)", async () => {
    const form = new FormData();
    form.set("slotId", "3");
    form.set("durationMonths", "1");
    form.set("adName", "Autumn launch");
    form.set("contactName", "Sam Advertiser");
    form.set("companyName", "");
    form.set("email", "sam@example.com");
    form.set("aboutAdvertiser", "");
    form.set("destinationUrl", "https://example.com/autumn");
    form.set("creative", new File([png(1280, 720)], "banner.png", { type: "image/png" }));
    const response = await POST(
      new Request("https://example.com/api/ads/submit", { method: "POST", body: form }),
    );
    expect(response.status).toBe(201);
  });

  it("names the field that is missing instead of a generic message", async () => {
    const form = new FormData();
    form.set("slotId", "3");
    form.set("durationMonths", "1");
    form.set("adName", "Autumn launch");
    form.set("contactName", "Sam Advertiser");
    form.set("email", "not-an-email");
    form.set("destinationUrl", "https://example.com/autumn");
    form.set("creative", new File([png(1280, 720)], "banner.png", { type: "image/png" }));
    const response = await POST(
      new Request("https://example.com/api/ads/submit", { method: "POST", body: form }),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/email/i);
    expect(body.error).not.toMatch(/16:9 banner/i);
  });

  it("accepts a square banner: any shape is framed into the 16:9 placement", async () => {
    const response = await POST(requestWith(1000, 1000));
    expect(response.status).toBe(201);
    const params = state.rpc.mock.calls[0]?.[1];
    expect(params).toMatchObject({ p_dimensions: "1000x1000" });
    // No framing sent means centred, untouched.
    expect(params).toMatchObject({ p_focus_x: 50, p_focus_y: 50, p_focus_zoom: 1 });
  });

  it("accepts an animated GIF and stores its framing", async () => {
    const response = await POST(
      requestWith(600, 900, { x: "20", y: "80", zoom: "1.8" }, gif(600, 900), "image/gif"),
    );
    expect(response.status).toBe(201);
    expect(state.upload.mock.calls[0]?.[0]).toMatch(/\.gif$/);
    const params = state.rpc.mock.calls[0]?.[1];
    expect(params).toMatchObject({
      p_file_type: "image/gif",
      p_dimensions: "600x900",
      p_focus_x: 20,
      p_focus_y: 80,
      p_focus_zoom: 1.8,
    });
  });

  it("clamps framing that arrived outside the allowed range", async () => {
    const response = await POST(requestWith(1200, 675, { x: "-40", y: "900", zoom: "9" }));
    // Out-of-range values are rejected by the schema rather than silently
    // stored, so a bad client can never rotate a banner 900% off-centre.
    expect(response.status).toBe(400);
    expect(state.upload).not.toHaveBeenCalled();
  });

  it("rejects a picture thinner than the placement before uploading", async () => {
    const response = await POST(requestWith(40, 40));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/at least/i);
    expect(state.upload).not.toHaveBeenCalled();
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
