import { afterEach, describe, expect, it, vi } from "vitest";
import { FunnyUsernameError, generateFunnyUsername } from "@/lib/community/anonymous-username";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("AI anonymous usernames", () => {
  it("asks OpenRouter for a funny username without exposing the key to the client", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key");
    vi.stubEnv("OPENROUTER_USERNAME_MODEL", "test/funny-model");
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "Professor Picklewhiskers" } }] }),
    });
    vi.stubGlobal("fetch", fetch);

    await expect(generateFunnyUsername()).resolves.toBe("Professor Picklewhiskers");
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer sk-or-test-key");
    expect(fetch.mock.calls[0][1].body).toContain("test/funny-model");
  });

  it("does not silently fall back to a locally generated username when AI is unavailable", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(generateFunnyUsername()).rejects.toBeInstanceOf(FunnyUsernameError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects malformed model output instead of accepting a non-AI fallback", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "Here is a longer explanation that cannot be a username" } }] }),
    }));

    await expect(generateFunnyUsername()).rejects.toBeInstanceOf(FunnyUsernameError);
  });
});
