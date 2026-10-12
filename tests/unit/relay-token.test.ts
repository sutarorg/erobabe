// @vitest-environment node
import { describe, it, expect } from "vitest";
import { RelayTokenError, signRelayToken, verifyRelayToken } from "@/lib/video/relay-token";
import { verifyRelayToken as verifyInRelay } from "../../relay/streamtape-relay.mjs";

const SECRET = "relay-secret-0123456789abcdef";
const payload = (over: Partial<{ u: string; s: string; exp: number }> = {}) => ({
  u: "https://tapecontent.net/xfsupload/abc",
  s: "session-1",
  exp: Date.now() + 60_000,
  ...over,
});

describe("relay tokens", () => {
  it("round-trips and is verifiable by both the app and the standalone relay", () => {
    const token = signRelayToken(payload(), SECRET);
    expect(verifyRelayToken(token, SECRET).s).toBe("session-1");
    expect(verifyInRelay(token, SECRET).u).toContain("tapecontent.net");
  });

  it("refuses weak secrets and incomplete payloads when signing", () => {
    expect(() => signRelayToken(payload(), "short")).toThrow(/at least 16/);
    expect(() => signRelayToken({ ...payload(), u: "" }, SECRET)).toThrow(RelayTokenError);
  });

  it("rejects a tampered payload, a wrong secret and malformed tokens", () => {
    const token = signRelayToken(payload(), SECRET);
    const [v, body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload(), u: "https://evil.example.com/x" })).toString("base64url");
    expect(() => verifyRelayToken(`${v}.${forged}.${sig}`, SECRET)).toThrow(/signature/);
    expect(() => verifyRelayToken(token, "another-secret-0123456789")).toThrow(/signature/);
    for (const bad of ["", "abc", "v2.a.b", `${v}.${body}`]) {
      expect(() => verifyRelayToken(bad, SECRET)).toThrow(RelayTokenError);
      expect(() => verifyInRelay(bad, SECRET)).toThrow(/token|secret/i);
    }
  });

  it("rejects expired tokens and absurdly long-lived ones", () => {
    const expired = signRelayToken(payload({ exp: Date.now() - 1 }), SECRET);
    expect(() => verifyRelayToken(expired, SECRET)).toThrow(/expired/);
    expect(() => verifyInRelay(expired, SECRET)).toThrow(/expired/);
    const forever = signRelayToken(payload({ exp: Date.now() + 365 * 24 * 3600 * 1000 }), SECRET);
    expect(() => verifyRelayToken(forever, SECRET)).toThrow(/longer than allowed/);
  });
});
