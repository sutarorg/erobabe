import { describe, it, expect } from "vitest";
import { parseUqloadUploadResponse } from "@/lib/video/uqload-response";

describe("parseUqloadUploadResponse", () => {
  it("reads filecode from the documented files[] payload", () => {
    const parsed = parseUqloadUploadResponse(
      JSON.stringify({
        msg: "OK",
        status: 200,
        files: [{ filecode: "u9150wqzvhxj", filename: "1.avi", status: "OK" }],
      })
    );
    expect(parsed.filecode).toBe("u9150wqzvhxj");
    expect(parsed.filename).toBe("1.avi");
  });

  it("accepts status as a string", () => {
    const parsed = parseUqloadUploadResponse(JSON.stringify({ status: "200", files: [{ filecode: "abc" }] }));
    expect(parsed.filecode).toBe("abc");
  });

  it("rejects empty or invalid bodies", () => {
    expect(() => parseUqloadUploadResponse("")).toThrow(/empty/i);
    expect(() => parseUqloadUploadResponse("<html>nope</html>")).toThrow(/invalid/i);
  });

  it("surfaces Uqload's msg on failure", () => {
    expect(() => parseUqloadUploadResponse(JSON.stringify({ status: 400, msg: "bad key" }))).toThrow(/bad key/);
  });
});
