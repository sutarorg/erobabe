// @vitest-environment node
import { describe, it, expect } from "vitest";
import { boundedJson, escapeHtml, RequestError } from "@/lib/http/safety";
describe("bounded public input", () => {
  it("escapes every HTML interpolation delimiter", () => {
    expect(escapeHtml(`<img src="x" onerror='x'>&`)).toBe(
      "&lt;img src=&quot;x&quot; onerror=&#39;x&#39;&gt;&amp;",
    );
  });
  it("rejects malformed JSON and oversized streamed bodies regardless of Content-Length", async () => {
    await expect(
      boundedJson(
        new Request("https://example.com", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{",
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      boundedJson(
        new Request("https://example.com", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": "1",
          },
          body: JSON.stringify({ message: "a".repeat(2048) }),
        }),
        1024,
      ),
    ).rejects.toMatchObject({ status: 413 });
  });
  it("rejects form encoding so simple cross-site posts cannot trigger writes", async () => {
    await expect(
      boundedJson(
        new Request("https://example.com", { method: "POST", body: "x=y" }),
      ),
    ).rejects.toBeInstanceOf(RequestError);
  });
});
