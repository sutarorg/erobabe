// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

const state = vi.hoisted(() => ({
  user: { id: "staff-1" } as { id: string } | null,
  profile: { role: "admin", status: "active" } as { role: string; status: string } | null,
  error: null as unknown,
  getUser: vi.fn(),
  profileRead: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: any) => {
    const query = {
      select: () => query,
      eq: () => query,
      single: async () => {
        state.profileRead();
        return { data: state.profile, error: state.error };
      },
    };
    return {
      auth: {
        getUser: async () => {
          state.getUser();
          options.cookies.setAll([{ name: "refreshed-session", value: "fixture", options: { httpOnly: true } }]);
          return { data: { user: state.user } };
        },
      },
      from: () => query,
    };
  },
}));

const request = (path: string) => new NextRequest(`https://example.com${path}`, { headers: { RSC: "1" } });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "fixture-public-key");
  state.user = { id: "staff-1" };
  state.profile = { role: "admin", status: "active" };
  state.error = null;
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllEnvs());

describe("per-request admin authorization and public guest checkout", () => {
  it("allows active admins and refreshes their session", async () => {
    const response = await middleware(request("/admin/payments"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(state.profileRead).toHaveBeenCalledOnce();
    expect(response.cookies.get("refreshed-session")?.value).toBe("fixture");
  });

  it("rejects non-admin roles from staff pages", async () => {
    state.profile = { role: "advertiser", status: "active" };
    const response = await middleware(request("/admin/users"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/admin/signin");
  });

  it("blocks suspended admins, including RSC requests", async () => {
    state.profile = { role: "admin", status: "suspended" };
    const response = await middleware(request("/admin/payments"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/admin/signin");
    expect(response.cookies.get("refreshed-session")?.value).toBe("fixture");
  });

  it("does not reuse a cached layout role after suspension", async () => {
    expect((await middleware(request("/admin"))).headers.get("x-middleware-next")).toBe("1");
    state.profile!.status = "suspended";
    expect((await middleware(request("/admin/advertisements"))).status).toBe(307);
    expect(state.profileRead).toHaveBeenCalledTimes(2);
  });

  it("fails closed for a missing profile or profile query failure", async () => {
    state.profile = null;
    expect((await middleware(request("/admin"))).status).toBe(307);
    state.profile = { role: "admin", status: "active" };
    state.error = { message: "database unavailable" };
    expect((await middleware(request("/admin"))).status).toBe(307);
  });

  it("rejects anonymous staff requests before querying profiles", async () => {
    state.user = null;
    expect((await middleware(request("/admin/videos"))).status).toBe(307);
    expect(state.profileRead).not.toHaveBeenCalled();
  });

  it("leaves checkout, public pages, removed portal URLs, and admin sign-in outside auth", async () => {
    for (const path of ["/", "/popular", "/checkout?slot=1", "/advertiser", "/admin/signin"]) {
      expect((await middleware(request(path))).headers.get("x-middleware-next")).toBe("1");
    }
    expect(state.getUser).not.toHaveBeenCalled();
  });
});
