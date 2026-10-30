// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const state = vi.hoisted(() => ({ calls: 0, fail: false, body: null as Buffer | null }));

vi.mock("@/lib/ads/payment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ads/payment")>();
  return { ...actual, PAYMENT_PANEL_IMAGE_URL: "https://i.ibb.co/example/artwork.png" };
});

/**
 * The route keeps its copy of the artwork in module memory, which is the point
 * of it — so each test loads a fresh module instead of sharing the cache.
 */
async function route() {
  vi.resetModules();
  return import("@/app/api/assets/payment-artwork/route");
}

/** A real 2000 × 1125 PNG, so the resize path is exercised for real. */
async function artwork() {
  if (!state.body) {
    state.body = await sharp({
      create: { width: 2000, height: 1125, channels: 3, background: { r: 20, g: 20, b: 24 } },
    })
      .png()
      .toBuffer();
  }
  return state.body;
}

beforeEach(() => {
  state.calls = 0;
  state.fail = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      state.calls += 1;
      if (state.fail) return new Response("nope", { status: 503 });
      return new Response(new Uint8Array(await artwork()), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function request(query = "") {
  return new Request(`https://erobabe.com/api/assets/payment-artwork${query}`);
}

describe("GET /api/assets/payment-artwork", () => {
  it("serves a much smaller re-encoded copy from our own origin", async () => {
    const response = await (await route()).GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/avif");

    const bytes = Buffer.from(await response.arrayBuffer());
    const original = await artwork();
    expect(bytes.length).toBeLessThan(original.length);
    // The panel never needs more than 1400 px of width.
    const meta = await sharp(bytes).metadata();
    expect(meta.width).toBe(1400);
    expect(meta.height).toBeLessThan(1125);
  });

  it("is cached immutably for a year", async () => {
    const response = await (await route()).GET(request());
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(response.headers.get("cache-control")).toContain("max-age=31536000");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("fetches the artwork once, then answers from memory", async () => {
    const { GET } = await route();
    await GET(request());
    await GET(request());
    await GET(request());
    // A second width is the only thing that needs another upstream read.
    await GET(request("?w=mobile"));
    expect(state.calls).toBe(2);
  });

  it("serves the smaller phone variant on request", async () => {
    const response = await (await route()).GET(request("?w=mobile"));
    const meta = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    expect(meta.width).toBe(900);
  });

  it("redirects to the hosted file when the origin is down, with a short cache", async () => {
    state.fail = true;
    const response = await (await route()).GET(request());
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://i.ibb.co/example/artwork.png");
    expect(response.headers.get("cache-control")).toContain("max-age=60");
  });

  it("redirects rather than throwing when the network rejects the fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const response = await (await route()).GET(request());
    expect(response.status).toBe(302);
  });
});
