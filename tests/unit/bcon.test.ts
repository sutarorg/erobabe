import { describe, it, expect } from "vitest";
import { mapBconStatus, parseBconCallback } from "@/lib/bcon/client";

describe("bcon client", () => {
  it("maps bcon statuses", () => {
    expect(mapBconStatus("confirmed")).toBe("confirmed");
    expect(mapBconStatus("unconfirmed")).toBe("unconfirmed");
    expect(mapBconStatus("partially_confirmed")).toBe("partially_confirmed");
    expect(mapBconStatus("2")).toBe("confirmed");
  });

  it("parses callback query", () => {
    const url = new URL("https://example.com/api/bcon/callback?addr=0x123&txid=0xabc&value=99&external_id=test-123&status=confirmed");
    const parsed = parseBconCallback(url);
    expect(parsed.addr).toBe("0x123");
    expect(parsed.txid).toBe("0xabc");
    expect(parsed.external_id).toBe("test-123");
  });
});
