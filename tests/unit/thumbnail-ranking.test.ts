import { afterEach, describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { rankThumbnailCandidates } from "@/lib/video/thumbnail-ranking";
const frames = ["data:image/jpeg;base64,YQ==", "data:image/jpeg;base64,Yg=="];
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function enabled() {
  vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
  vi.stubEnv("OPENROUTER_THUMBNAIL_MODEL", "verified/model");
  vi.stubEnv("OPENROUTER_THUMBNAIL_PROVIDER", "operator-approved");
  vi.stubEnv("OPENROUTER_THUMBNAIL_ENABLED", "true");
  vi.stubEnv("OPENROUTER_THUMBNAIL_CONTENT_APPROVED", "true");
}
describe("optional vision ranking", () => {
  it("never sends frames without both operator gates", async () => {
    enabled();
    vi.stubEnv("OPENROUTER_THUMBNAIL_CONTENT_APPROVED", "false");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await rankThumbnailCandidates(frames)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("verifies live image capability before transmitting", async () => {
    enabled();
    const fetch = vi.fn(async () =>
      Response.json({
        data: [
          {
            id: "verified/model",
            architecture: { input_modalities: ["text"] },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetch);
    expect(await rankThumbnailCandidates(frames)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("pins model/provider and ranks only actual candidates", async () => {
    enabled();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          data: [
            {
              id: "verified/model",
              architecture: { input_modalities: ["text", "image"] },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ choices: [{ message: { content: '{"index":1}' } }] }),
      );
    vi.stubGlobal("fetch", fetch);
    expect(await rankThumbnailCandidates(frames)).toBe(1);
    const body = JSON.parse(fetch.mock.calls[1][1].body);
    expect(body.provider).toMatchObject({
      only: ["operator-approved"],
      allow_fallbacks: false,
    });
  });
  it("falls back deterministically on rejection/unavailability", async () => {
    enabled();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("rejected");
      }),
    );
    expect(await rankThumbnailCandidates(frames)).toBeNull();
  });
});
