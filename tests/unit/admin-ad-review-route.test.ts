// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  sendEmail: vi.fn(),
  service: null as any,
  order: null as any,
}));

vi.mock("@/lib/video/publishing", () => ({
  requireActiveAdmin: async () => ({ user: { id: "admin-1" }, service: state.service }),
  errorStatusFrom: () => 500,
}));
vi.mock("@/lib/public/revalidate", () => ({ revalidatePublicTag: vi.fn() }));
vi.mock("@/lib/resend/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/resend/client")>();
  return { ...actual, sendEmail: state.sendEmail };
});

import { POST } from "@/app/api/admin/advertisements/route";

function request(action: string) {
  return new Request("https://example.com/api/admin/advertisements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "88888888-8888-4888-8888-888888888888", action }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.rpc.mockResolvedValue({ error: null });
  state.sendEmail.mockResolvedValue({ id: "resend-message-1" });
  state.order = {
    id: "88888888-8888-4888-8888-888888888888",
    email: "alex@example.com",
    ad_name: "Summer launch",
    slot_id: 1,
    ends_at: "2026-11-27T00:00:00.000Z",
    status: "live",
    live_email_sent_at: null,
  };
  state.from.mockImplementation(() => ({
    select: () => ({
      eq: () => ({ single: async () => ({ data: state.order, error: null }) }),
    }),
    update: () => ({ eq: async () => ({ error: null }) }),
  }));
  state.service = { rpc: state.rpc, from: state.from };
});

describe("admin ad review and Resend fulfilment", () => {
  it("verifies PayPal manually without publishing or emailing", async () => {
    const response = await POST(request("verify_payment"));
    expect(response.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("admin_review_ad_order", {
      p_admin: "admin-1",
      p_order_id: "88888888-8888-4888-8888-888888888888",
      p_action: "verify_payment",
    });
    expect(state.sendEmail).not.toHaveBeenCalled();
    expect(state.from).not.toHaveBeenCalled();
  });

  it("sends ‘Your ad is live! Erobabe’ only after the make-live transition", async () => {
    const response = await POST(request("make_live"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updated: true, emailSent: true });
    expect(state.rpc).toHaveBeenCalledWith("admin_review_ad_order", expect.objectContaining({ p_action: "make_live" }));
    expect(state.sendEmail).toHaveBeenCalledOnce();
    expect(state.sendEmail.mock.calls[0]?.[0]).toMatchObject({
      to: "alex@example.com",
      subject: "Your ad is live! Erobabe",
    });
  });

  it("reports email failure honestly while keeping the ad live", async () => {
    state.sendEmail.mockRejectedValue(new Error("Resend unavailable"));
    const response = await POST(request("make_live"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ updated: true, emailSent: false });
  });
});
