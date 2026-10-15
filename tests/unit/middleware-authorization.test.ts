// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

const state = vi.hoisted(() => ({
  user: { id: "advertiser-1" } as { id: string } | null,
  profile: { role: "advertiser", status: "active" } as {
    role: string;
    status: string;
  } | null,
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
          options.cookies.setAll([
            {
              name: "refreshed-session",
              value: "fixture",
              options: { httpOnly: true },
            },
          ]);
          return { data: { user: state.user } };
        },
      },
      from: () => query,
    };
  },
}));
const request = (path: string) =>
  new NextRequest(`https://example.com${path}`, { headers: { RSC: "1" } });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "fixture-public-key");
  state.user = { id: "advertiser-1" };
  state.profile = { role: "advertiser", status: "active" };
  state.error = null;
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllEnvs());

describe("per-request protected page authorization", () => {
  it.each(["admin", "advertiser"])(
    "allows active %s in its own portal",
    async (role) => {
      state.profile!.role = role;
      const response = await middleware(request(`/${role}/payments`));
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(state.profileRead).toHaveBeenCalledOnce();
      expect(response.cookies.get("refreshed-session")?.value).toBe("fixture");
    },
  );
  it.each(["admin", "advertiser"])(
    "blocks suspended %s, including RSC requests",
    async (role) => {
      state.profile = { role, status: "suspended" };
      const response = await middleware(request(`/${role}/payments`));
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toContain(
        role === "admin" ? "/admin/signin" : "/auth/sign-in",
      );
      expect(response.cookies.get("refreshed-session")?.value).toBe("fixture");
    },
  );
  it("does not reuse a cached layout's active role after suspension", async () => {
    expect(
      (await middleware(request("/advertiser/campaigns"))).headers.get(
        "x-middleware-next",
      ),
    ).toBe("1");
    state.profile!.status = "suspended";
    expect((await middleware(request("/advertiser/billing"))).status).toBe(307);
    expect(state.profileRead).toHaveBeenCalledTimes(2);
  });
  it("rejects advertiser access to service-backed admin pages", async () => {
    expect(
      (await middleware(request("/admin/users"))).headers.get("location"),
    ).toContain("/admin/signin");
  });
  it("routes an active administrator to its own portal", async () => {
    state.profile!.role = "admin";
    expect(
      (await middleware(request("/advertiser?foo=bar"))).headers.get(
        "location",
      ),
    ).toBe("https://example.com/admin");
  });
  it("fails closed for a missing profile or profile query failure", async () => {
    state.profile = null;
    expect((await middleware(request("/advertiser"))).status).toBe(307);
    state.profile = { role: "admin", status: "active" };
    state.error = { message: "database unavailable" };
    expect((await middleware(request("/admin"))).status).toBe(307);
  });
  it("rejects anonymous users before querying profiles", async () => {
    state.user = null;
    expect((await middleware(request("/admin/videos"))).status).toBe(307);
    expect(state.profileRead).not.toHaveBeenCalled();
  });
  it("leaves public pages and admin sign-in available without profile queries", async () => {
    for (const path of ["/", "/popular", "/admin/signin", "/auth/sign-in"]) {
      expect(
        (await middleware(request(path))).headers.get("x-middleware-next"),
      ).toBe("1");
    }
    expect(state.getUser).not.toHaveBeenCalled();
  });
});
